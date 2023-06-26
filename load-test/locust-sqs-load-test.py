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
ACCOUNT = os.environ.get("ACCOUNT") if os.environ.get("ACCOUNT") else "012345678901"
BATCH_SIZE = int(os.environ.get("LOCUST_BATCH_SIZE")) if os.environ.get("LOCUST_BATCH_SIZE") else 1

faker = Faker()


class SqsBotoClient:
    def __init__(self, region_name, queue_name, batch_size):
        self.sqs_client = boto3.client('sqs', region_name=region_name)
        self.queue_url = f"https://sqs.{REGION}.amazonaws.com/{ACCOUNT}/{queue_name}"
        self.batch_size = batch_size

        logging.info("Created SqsBotoClient in '%s' for SQS queue '%s'", region_name, self.queue_url)

    def send(self, payload):
        request_meta = {
            "request_type": "Send data",
            "name": "SQS",
            "start_time": time.time(),
            "response_length": 0,
            "response": None,
            "context": {},
            "exception": None,
        }
        start_perf_counter = time.perf_counter()

        try:
            self.sqs_client.send_message(
                QueueUrl=self.queue_url,
                MessageBody=json.dumps(payload))
        except Exception as e:
            request_meta['exception'] = e

        request_meta["response_time"] = (
            time.perf_counter() - start_perf_counter) * 1000

        events.request.fire(**request_meta)


class SqsBotoUser(User):
    abstract = True

    def __init__(self, env):
        super().__init__(env)
        self.client = SqsBotoClient(region_name=REGION, queue_name=self.host, batch_size=BATCH_SIZE)


class SensorAPIUser(SqsBotoUser):
    wait_time = constant(1)

    def generate_sensor_reading(self, sensor_id):
        current_temperature = round(10 + random.random() * 170, 2)

        if current_temperature > 160:
            status = "ERROR"
        elif current_temperature > 140 or random.randrange(1, 100) > 80:
            status = random.choice(["WARNING", "ERROR"])
        else:
            status = "OK"

        return {
            'sensorId': sensor_id,
            'temperature': current_temperature,
            'status': status,
            'timestamp': round(time.time()*1000)
        }

    def on_start(self):
        self.user_id = str(uuid.uuid4())
        return super().on_start()

    @task
    def send_sensor_value(self):
        sensor_reading = self.generate_sensor_reading(self.user_id)
        event = {'Data': json.dumps(sensor_reading)}

        logging.debug("Generated event for SQS: %s", event)
        self.client.send(event)
