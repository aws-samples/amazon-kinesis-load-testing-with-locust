#!/bin/bash

source locust.env

export REGION=$(curl --silent --retry 5 --retry-all-errors http://169.254.169.254/latest/meta-data/placement/region)
echo "Locust runs in $REGION"

if [ -z "$LOCUST_NUMBER_OF_SECONDARIES" ]; then
  echo "Please provide the number of secondaries to start";
  exit 1;
fi

echo "Start $LOCUST_NUMBER_OF_SECONDARIES secondaries..."

for((i=0;i<$LOCUST_NUMBER_OF_SECONDARIES;i++))
do
  echo "Start secondary number $i ..."
  locust -f locust-load-test.py --worker &
  echo "Started secondary number $i"
done

echo "All $LOCUST_NUMBER_OF_SECONDARIES secondaries are running"

echo "Start primary..."
locust -f locust-load-test.py --master --host $KINESIS_DEFAULT_STREAM_NAME --web-auth $LOCUST_DASHBOARD_USER:$LOCUST_DASHBOARD_PWD
echo "Started primary"
