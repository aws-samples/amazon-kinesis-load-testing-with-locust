import os
import boto3
import json
import random
import time
import uuid
import logging
from locust import User, task, constant, events
from faker import Faker

REGION = os.environ.get("REGION") if os.environ.get("REGION") else "eu-central-1"
BATCH_SIZE = int(os.environ.get("LOCUST_BATCH_SIZE")) if os.environ.get("LOCUST_BATCH_SIZE") else 1

faker = Faker()


class KinesisBotoClient:
    def __init__(self, region_name, stream_name, batch_size):
        self.kinesis_client = boto3.client('kinesis', region_name=region_name)
        self.stream_name = stream_name
        self.batch_size = batch_size

        logging.info("Created KinesisBotoClient in '%s' for Kinesis stream '%s'", region_name, stream_name)

    def send(self, records):
        request_meta = {
            "request_type": "Send data",
            "name": "Kinesis",
            "start_time": time.time(),
            "response_length": 0,
            "response": None,
            "context": {},
            "exception": None,
        }
        start_perf_counter = time.perf_counter()

        try:
            self.kinesis_client.put_records(
                StreamName=self.stream_name, Records=records)
        except Exception as e:
            request_meta['exception'] = e

        request_meta["response_time"] = (
            time.perf_counter() - start_perf_counter) * 1000

        for _ in range(self.batch_size):
            events.request.fire(**request_meta)


class KinesisBotoUser(User):
    abstract = True

    def __init__(self, env):
        super().__init__(env)
        self.client = KinesisBotoClient(region_name=REGION, stream_name=self.host, batch_size=BATCH_SIZE)


class SensorAPIUser(KinesisBotoUser):
    wait_time = constant(1)

    def generate_sensor_reading(self, sensor_id, sensor_reading):
        current_temperature = round(10 + random.random() * 170, 2)

        if current_temperature > 160:
            status = "ERROR"
        elif current_temperature > 140 or random.randrange(1, 100) > 80:
            status = random.choice(["WARNING", "ERROR"])
        else:
            status = "OK"

        return {
            'sensorId': f"{sensor_id}_{sensor_reading}",
            'temperature': current_temperature,
            'status': status,
            'timestamp': round(time.time()*1000)
        }

    def on_start(self):
        self.user_id = str(uuid.uuid4())
        return super().on_start()

    @task
    def send_sensor_value(self):
        events = []
        for i in range(BATCH_SIZE):
            sensor_reading = self.generate_sensor_reading(self.user_id, i)
            event = {'Data': json.dumps(sensor_reading), 'PartitionKey': str(sensor_reading['sensorId'])}
            events.append(event)

        logging.debug("Generated events for Kinesis: %s", events)
        self.client.send(events)
