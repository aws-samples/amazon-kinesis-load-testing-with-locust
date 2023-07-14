[![Build & Test](https://github.com/aws-samples/amazon-kinesis-load-testing-with-locust/actions/workflows/build-and-test-cdk.yml/badge.svg)](https://github.com/aws-samples/amazon-kinesis-load-testing-with-locust/actions/workflows/build-and-test-cdk.yml)

# Amazon Kinesis Load Testing with Locust

Easy [Amazon Kinesis](https://aws.amazon.com/kinesis/) load testing with [Locust](https://locust.io/) - a modern load testing framework.

## Table of contents

- [Overview](#overview)
- [Test locally](#test-locally)
- [Cloud setup](#cloud-setup)
   - [Bootstrap your environment](#bootstrap-your-environment)
   - [Install dependencies](#install-dependencies)
   - [CDK Deployment](#cdk-deployment)
   - [Accessing the Locust Dashboard](#accessing-the-locust-dashboard)
   - [Adopting the payload](#adopting-the-payload)
   - [Configuration changes](#configuration-changes)
   - [Destroy the stack](#destroy-the-stack)
- [Large scale load testing](#large-scale-load-testing)
   - [Instance size](#instance-size)
   - [Number of secondaries](#number-of-secondaries)
   - [Batch size](#batch-size)
   - [EC2 instance type](#ec2-instance-type)
- [Project structure](#project-structure)
- [Remarks](#remarks)
- [Notice](#notice)
- [Security](#security)
- [License](#license)

## Overview

For high-traffic Kinesis based application, it's often a challenge to simulate the necessary load in a load test. Locust is a powerful Python based framework to execute load test. This project leverages a [Boto3](https://boto3.amazonaws.com/v1/documentation/api/latest/index.html) wrapper for Locust.

![Dashboard Overview](img/Dashboard%20overview.png)

This project emits temperature sensor readings via Locust to Kinesis. The EC2 Locust instance is setup via CDK to load test Kinesis based applications. Users can connect via [Systems Manager Session Manager (SSM)](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/session-manager.html) for [configuration changes](#configuration-changes). For your convenience, it deploys a Kinesis Data Stream called `DemoStream` as well, to get you started. If you want to adapt or disable it, you can find the resource [here](infrastructure/kinesis-load-testing-with-locust.ts#L63-L66).

![Architecture Overview](img/Architecture%20Overview.png)


In our testing with the largest [recommended instance](#ec2-instance-type) - `c7g.16xlarge` - the setup was capable of emitting over 1 million events per second to Kinesis, with a batch size of 500. See also [here](#large-scale-load-testing) for more information on how to achieve peak performance.

Alternatively your can use the [Amazon Kinesis Data Generator](https://github.com/awslabs/amazon-kinesis-data-generator), which provides you with a hosted UI to set up Kinesis load tests. As this approach is browser based, you are limited by the bandwidth of your current connection, the round trip latency and have to keep the browser tab open to continue sending events.

## Test locally
To test Locust out locally first, before [deploying it to the cloud](#cloud-setup), you have to install the necessary Python dependencies. You can find more information in the [Pip Getting Started Guide](https://pip.pypa.io/en/stable/getting-started/).

Navigate to the `load-test` directory and run:

```bash
pip install -r requirements.txt
```

In order to send events to Kinesis from your local machine, you have to have AWS credentials, see also the documentation on [Configuration and credential file settings](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html)

To perform now the test locally, stay in the `load-test` directory and run:

```bash
locust -f locust-load-test.py
```

You can now access the Locust dashboard via http://0.0.0.0:8089/. Enter the number of Locust users, the spawn rate (users added per second) and the target Amazon Kinesis data stream name as host.

![Setup stream details local](img/Setup%20stream%20details%20local.png)


In order to get the generated events logged out, run this command, it will filter only locust and root logs (e.g. no botocore logs):
```bash
locust -f locust-load-test.py --loglevel DEBUG 2>&1 | grep -E "(locust|root)"
```

## Cloud setup
This project relies on [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/home.html) and [TypeScript](https://www.typescriptlang.org/), for installation instructions look [here](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_install). 
For further information you can also checkout [this Workshop](https://cdkworkshop.com/) and [this Getting Started](https://aws.amazon.com/getting-started/guides/setup-cdk/).

### Bootstrap your environment
```bash
cdk bootstrap
```

For more details, see [AWS Cloud Development Kit - Bootstrapping](https://docs.aws.amazon.com/cdk/latest/guide/bootstrapping.html).

### Install dependencies
```bash
npm install
```

### CDK Deployment
Run the following to deploy the stacks of the cdk template:
```bash
cdk deploy
```


### Accessing the Locust Dashboard
To get started you first have to do the setup, as described [here](#setup). 
You can access the dashboard by using the CDK Output `KinesisLoadTestingWithLocustStack.locustdashboardurl` to open the dashboard, e.g. http://1.2.3.4:8089.

The Locust dashboard is password protected, by default it is set to Username `locust-user` and Password `locust-dashboard-pwd`, you can change it [here](load-test/locust.env#L4-L5).

With the default configuration, you can achieve up to 15.000 emitted events per second. Enter the number of Locust users (times the batch size), the spawn rate (users added per second) and the target Kinesis stream name as host.

![Setup stream details](img/Setup%20stream%20details.png)


The default settings:
* Instance: `c7g.xlarge`
* Number of secondaries: `4`
* Batch size: `10`
* Host (Kinesis stream name): `kinesis-load-test-input-stream`, you can change the default host [here](load-test/locust.env#L3)

If you want to achieve more load, checkout [Large scale load testing](#large-scale-load-testing) documentation.

### Adopting the payload
By default, this project generates random temperature sensor readings for every sensor with this format:
```json
 {
    "sensorId": "bfbae19c-2f0f-41c2-952b-5d5bc6e001f1_1",
    "temperature": 147.24,
    "status": "OK",
    "timestamp": 1675686126310
 }
```

To adopt it to your needs, the project comes packaged with [Faker](https://faker.readthedocs.io/en/master/), that you can use to adopt the payload to your needs.
If you want to use a different payload or payload format, please change it [here](load-test/locust-load-test.py#L61-L76).

### Configuration changes

Locust is created on the EC2 instance as a [systemd](https://systemd.io/) service and can therefore be controlled with [systemctl](https://www.commandlinux.com/man-page/man1/systemctl.1.html). If you want to change the configuration of Locust on-the-fly without redeploying the stack, you can connect to the instance via [Systems Manager Session Manager (SSM)](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/session-manager.html), navigate to the project directory on `/usr/local/load-test`, change the [locust.env](load-test/locust.env) file and restart the service by running `sudo systemctl restart locust`.

### Destroy the stack
In order to not incur any unnecessary costs, you can simply delete the stack.

```bash
cdk destroy
```

## Large scale load testing
In order to achieve peak performance with Locust and Kinesis, there are a couple of things to keep in mind.

### Instance size
Your performance is bound by the underlying EC2 instance, so check [recommended instance](#ec2-instance-type) for more information about scaling. In order to set the correct instance size, you can configure the instanze size [here](infrastructure/kinesis-load-testing-with-locust.ts#L28).

### Number of secondaries
Locust benefits from a distributed setup. Therefore the setup spins up multiple secondaries, that do the actual work, and a primary, that does the coordination. In order to leverage the cores up to maximum, you should specify 1 secondary per core, you can configure the number [here](load-test/locust.env#L1).

### Batch size
The amount of Kinesis events you can send per Locust user is limited, due to the resource overhead of switching Locust users and by this threads. To overcome this, you can configure a batch size, to define how much users are simulated, per Locust user. These are send as a Kinesis [put_records](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/kinesis/client/put_records.html) call. You can configure the number [here](load-test/locust.env#L2).

![Peak load](img/Peak%20load.png)

The load test was achieved with this settings:
* Region: `eu-central-1` (Frankfurt)
* Instance: `c7g.16xlarge`
* Number of secondaries: `64`
* Batch size: `500`

### EC2 instance type

For Kinesis load testing with Locust, Locust is a compute and network intensive workload, that can also run on ARM for better cost-efficiency.
`C7G` is the latest compute optimized instance type, that runs on ARM with Graviton.

Below you can find an overview of possible EC2 instances, that you could select, based on the peak load requirements of your test. If you want you can change the instance type in CDK.

| API Name     | vCPUs    | Memory    | Network Performance | On Demand cost | Spot Minimum cost |
|--------------|----------|-----------|---------------------|----------------|-------------------|
| c7g.large    | 2 vCPUs  | 4.0 GiB   | Up to 12.5 Gigabit  | $0.0725 hourly | $0.0466 hourly    |
| c7g.xlarge   | 4 vCPUs  | 8.0 GiB   | Up to 12.5 Gigabit  | $0.1450 hourly | $0.0946 hourly    |
| c7g.2xlarge  | 8 vCPUs  | 16.0 GiB  | Up to 15 Gigabit    | $0.2900 hourly | $0.1841 hourly    |
| c7g.4xlarge  | 16 vCPUs | 32.0 GiB  | Up to 15 Gigabit    | $0.5800 hourly | $0.4188 hourly    |
| c7g.8xlarge  | 32 vCPUs | 64.0 GiB  | 15 Gigabit          | $1.1600 hourly | $0.7469 hourly    |
| c7g.12xlarge | 48 vCPUs | 96.0 GiB  | 22.5 Gigabit        | $1.7400 hourly | $1.0743 hourly    |
| c7g.16xlarge | 64 vCPUs | 128.0 GiB | 30 Gigabit          | $2.3200 hourly | $1.4842 hourly    |

The pricing information is according to `us-east-1` (North Virginia). To find the most accurate pricing information, see [here](https://aws.amazon.com/ec2/pricing/on-demand/).

Please keep in mind, that not only the EC2 instance costs, but especially the [data transfer costs](https://aws.amazon.com/ec2/pricing/on-demand#Data_Transfer) contribute to your costs.

## Project structure
```
docs/                                 -- Contains project documentation
infrastructure/                       -- Contains the CDK infrastructure definition
load-test/                            -- Contains all the load testing scripts
├── locust-load-test.py               -- Locust load testing definition
├── locust.env                        -- Locust environment variables
├── requirements.txt                  -- Defines all needed Python dependencies
├── start-locust.sh                   -- Script to start Locust to run in a distruted mode
└── stop-locust.sh                    -- Script to stop all Locust workers and the master
```

## Remarks
For simplicity of the setup and to reduce waiting times in the initial setup, the default VPC is used. If you want to create your custom VPC or reuse an already defined VPC, you can change it [here](infrastructure/kinesis-load-testing-with-locust.ts#L39-L42).

The setup also requires, that the EC2 instance is accessible on port 8089 inside this VPC, so make sure an Internet Gateway is set up, and nothing restricts the port access (e.g. NACLs, ...).

## Notice
This is a sample solution intended as a starting point and should not be used in a productive setting without thorough analysis and considerations on the user's side.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
