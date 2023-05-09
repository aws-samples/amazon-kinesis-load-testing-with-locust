#!/bin/bash

echo "Locust tasks before"
ps aux | grep locust

killall -9 locust
sleep 1

echo "Locust tasks after clean up"
ps aux | grep locust
