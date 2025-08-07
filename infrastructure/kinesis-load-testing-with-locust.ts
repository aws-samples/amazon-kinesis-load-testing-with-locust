import * as cdk from "aws-cdk-lib";
import {
  CfnDashboard,
} from "aws-cdk-lib/aws-cloudwatch";
import {
  AmazonLinuxCpuType,
  CloudFormationInit,
  InitCommand,
  InitPackage,
  InitService,
  Instance,
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  UserData,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import * as kinesis from "aws-cdk-lib/aws-kinesis";
import { Asset } from "aws-cdk-lib/aws-s3-assets";
import { Construct } from "constructs";
import path = require("path");

const LOCUST_DEFAULT_PORT = 8089;
const LOCUST_INSTANCE_SIZE = InstanceSize.XLARGE;

const LOAD_TEST_FILE_PATH = "/usr/local/load-test";
const LOAD_TEST_ASSET_FILE_NAME = "load-test-assets.zip";
const LOCUST_SERIVCE_NAME = "locust.service";
const SYSTEMD_SERIVCE_PATH = "/etc/systemd/system";

export class KinesisLoadTestingWithLocustStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Get the default VPC. This is the network where your instance will be provisioned
    // All activated regions in AWS have a default vpc.
    // You can create your own of course as well. https://aws.amazon.com/vpc/
    const loadTestingVpc = new Vpc(this, "Load testing VPC", {
      natGateways: 0,
      maxAzs: 3,
      subnetConfiguration: [
        {
          name: 'PublicSubnet',
          subnetType: SubnetType.PUBLIC,
        },
      ],
    })

    // Create the role with EC2 and add permissions to connect via SSM and full access to Kinesis in order to send events
    const role = new Role(this, "kinesis-locust-load-test-ec2-role", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
    });
    role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));
    role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("AmazonKinesisFullAccess"));

    // Set up security group to access the locust dashboard. As the dashboard
    const securityGroup = new SecurityGroup(this, "kinesis-load-testing-with-locust-sg", {
      vpc: loadTestingVpc,
      allowAllOutbound: true,
      securityGroupName: "kinesis-load-testing-with-locust-sg",
    });
    securityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(LOCUST_DEFAULT_PORT),
      "Allows Locust Dashboard access from Internet"
    );

    const demoStream = new kinesis.Stream(this, "DemoStream", {
      streamName: "DemoStream",
      streamMode: kinesis.StreamMode.ON_DEMAND,

      removalPolicy: cdk.RemovalPolicy.DESTROY, // Remove to clean up the environment
    });

    const locustLoadTestDirectory = new Asset(this, "LocustLoadTestDirectory", {
      path: path.join(__dirname, "..", "load-test"),
    });
    const locustServiceDescriptor = new Asset(this, "LocustServiceDescriptor", {
      path: path.join(__dirname, LOCUST_SERIVCE_NAME),
    });
    locustLoadTestDirectory.grantRead(role);

    const userData = UserData.forLinux();
    userData.addS3DownloadCommand({
      bucket: locustLoadTestDirectory.bucket,
      bucketKey: locustLoadTestDirectory.s3ObjectKey,
      localFile: `${LOAD_TEST_FILE_PATH}/${LOAD_TEST_ASSET_FILE_NAME}`,
    });
    userData.addS3DownloadCommand({
      bucket: locustServiceDescriptor.bucket,
      bucketKey: locustServiceDescriptor.s3ObjectKey,
      localFile: `${SYSTEMD_SERIVCE_PATH}/${LOCUST_SERIVCE_NAME}`,
    });

    const initData = CloudFormationInit.fromElements(
      InitPackage.yum("gcc"),
      InitPackage.yum("python3-devel"),
      InitCommand.shellCommand(`unzip ${LOAD_TEST_ASSET_FILE_NAME}`, { cwd: LOAD_TEST_FILE_PATH }),
      InitCommand.shellCommand("pip3 install --upgrade pip"),
      InitCommand.shellCommand("pip3 install -r requirements.txt", { cwd: LOAD_TEST_FILE_PATH }),
      InitCommand.shellCommand(`PATH=/usr/local/bin:$PATH`),
      InitService.enable("locust")
    );

    // Finally lets provision our ec2 instance
    const locustLoadTestingInstance = new Instance(this, "kinesis-load-testing-with-locust-instance", {
      vpc: loadTestingVpc,
      role: role,
      securityGroup: securityGroup,
      instanceName: "kinesis-load-testing-with-locust-instance",
      instanceType: InstanceType.of(InstanceClass.COMPUTE7_GRAVITON3, LOCUST_INSTANCE_SIZE),
      machineImage: MachineImage.latestAmazonLinux2({
        cpuType: AmazonLinuxCpuType.ARM_64,
      }),
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      userData: userData,
      init: initData,

      detailedMonitoring: true, // Optional, enables detailed monitoring
    });

    new cdk.CfnOutput(this, "locust-dashboard-url", {
      value: `http://${locustLoadTestingInstance.instancePublicIp}:${LOCUST_DEFAULT_PORT}`,
    });

    const dashboard = new CfnDashboard(this, 'KinesisLoadTestDashboard', {
      dashboardName: 'KinesisLoadTestDashboard',
      dashboardBody: JSON.stringify({
        widgets: [
          {
            "type": "metric",
            "x": 0,
            "y": 0,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                ["AWS/EC2", "CPUUtilization", "InstanceId", "${InstanceId}", { "label": "${InstanceId} (TemperatureSensorDataProducer)", "region": `${this.region}` }],
                ["...", { "stat": "Average", "region": `${this.region}` }]
              ],
              "view": "timeSeries",
              "stat": "Maximum",
              "period": 60,
              "stacked": false,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "region": `${this.region}`,
              "title": "CPU utilization (%)"
            }
          },
          {
            "type": "metric",
            "x": 6,
            "y": 0,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                ["AWS/EC2", "StatusCheckFailed", "InstanceId", "${InstanceId}", { "label": "${InstanceId} (TemperatureSensorDataProducer)" }]
              ],
              "view": "timeSeries",
              "stat": "Average",
              "period": 60,
              "stacked": false,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "region": `${this.region}`,
              "title": "Status check failed (any) (count)"
            }
          },
          {
            "type": "metric",
            "x": 12,
            "y": 0,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                ["AWS/EC2", "StatusCheckFailed_Instance", "InstanceId", "${InstanceId}", { "label": "${InstanceId} (TemperatureSensorDataProducer)" }]
              ],
              "view": "timeSeries",
              "stat": "Average",
              "period": 60,
              "stacked": false,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "region": `${this.region}`,
              "title": "Status check failed (instance) (count)"
            }
          },
          {
            "type": "metric",
            "x": 18,
            "y": 0,
            "width": 6,
            "height": 4,
            "properties": {
              "view": "timeSeries",
              "stat": "Average",
              "period": 60,
              "stacked": false,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "region": `${this.region}`,
              "metrics": [
                ["AWS/EC2", "StatusCheckFailed_System", "InstanceId", "${InstanceId}", { "label": "${InstanceId} (TemperatureSensorDataProducer)" }]
              ],
              "title": "Status check failed (system) (count)"
            }
          },
          {
            "type": "metric",
            "x": 0,
            "y": 4,
            "width": 6,
            "height": 4,
            "properties": {
              "view": "timeSeries",
              "stat": "Average",
              "period": 60,
              "stacked": false,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "region": `${this.region}`,
              "metrics": [
                ["AWS/EC2", "NetworkIn", "InstanceId", "${InstanceId}", { "label": "${InstanceId} (TemperatureSensorDataProducer)" }]
              ],
              "title": "Network in (bytes)"
            }
          },
          {
            "type": "metric",
            "x": 6,
            "y": 4,
            "width": 6,
            "height": 4,
            "properties": {
              "view": "timeSeries",
              "stat": "Average",
              "period": 60,
              "stacked": false,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "region": `${this.region}`,
              "metrics": [
                ["AWS/EC2", "NetworkOut", "InstanceId", "${InstanceId}", { "label": "${InstanceId} (TemperatureSensorDataProducer)" }]
              ],
              "title": "Network out (bytes)"
            }
          },
          {
            "type": "metric",
            "x": 12,
            "y": 4,
            "width": 6,
            "height": 4,
            "properties": {
              "view": "timeSeries",
              "stat": "Average",
              "period": 60,
              "stacked": false,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "region": `${this.region}`,
              "metrics": [
                ["AWS/EC2", "NetworkPacketsIn", "InstanceId", "${InstanceId}", { "label": "${InstanceId} (TemperatureSensorDataProducer)" }]
              ],
              "title": "Network packets in (count)"
            }
          },
          {
            "type": "metric",
            "x": 18,
            "y": 4,
            "width": 6,
            "height": 4,
            "properties": {
              "view": "timeSeries",
              "stat": "Average",
              "period": 60,
              "stacked": false,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "region": `${this.region}`,
              "metrics": [
                ["AWS/EC2", "NetworkPacketsOut", "InstanceId", "${InstanceId}", { "label": "${InstanceId} (TemperatureSensorDataProducer)" }]
              ],
              "title": "Network packets out (count)"
            }
          },
          {
            "type": "metric",
            "x": 6,
            "y": 8,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                [{ "expression": `200 * 1 * IF(m5, 1, 1)`, "label": "Incoming data Limit", "id": "e6", "color": "#d62728", "region": `${this.region}`, "period": 60 }],
                [{ "expression": "m5/1024/1024/PERIOD(m5)", "id": "e1", "label": "Incoming data - sum (MB/s)", "region": `${this.region}`, "period": 60 }],
                ["AWS/Kinesis", "IncomingBytes", "StreamName", "${StreamName}", { "id": "m5", "visible": false, "stat": "Sum" }]
              ],
              "region": `${this.region}`,
              "yAxis": {
                "left": {
                  "min": 0,
                  "showUnits": false
                }
              },
              "title": "Incoming data - sum (MB/s)",
              "period": 60,
              "view": "timeSeries",
              "stacked": false,
              "stat": "Average"
            }
          },
          {
            "type": "metric",
            "x": 0,
            "y": 8,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                [{ "expression": `200 *\n              1000 * PERIOD(m6) * IF(m6, 1, 1)`, "label": "Incoming records Limit", "id": "e6", "color": "#d62728", "period": 60, "region": `${this.region}` }],
                ["AWS/Kinesis", "IncomingRecords", "StreamName", "${StreamName}", { "id": "m6", "visible": true }]
              ],
              "region": `${this.region}`,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "stat": "Sum",
              "title": "Incoming data - sum (Count)",
              "period": 60,
              "view": "timeSeries",
              "stacked": false
            }
          },
          {
            "type": "metric",
            "x": 12,
            "y": 8,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                [{ "expression": "m7/1024/1024/PERIOD(m7)", "id": "e1", "label": "PutRecord - sum (MB/s)", "region": `${this.region}`, "period": 60 }],
                ["AWS/Kinesis", "PutRecord.Bytes", "StreamName", "${StreamName}", { "id": "m7", "visible": false, "stat": "Sum" }]
              ],
              "region": `${this.region}`,
              "yAxis": {
                "left": {
                  "min": 0,
                  "showUnits": false
                }
              },
              "title": "PutRecord - sum (MB/s)",
              "period": 60,
              "view": "timeSeries",
              "stacked": false,
              "stat": "Average"
            }
          },
          {
            "type": "metric",
            "x": 18,
            "y": 8,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                ["AWS/Kinesis", "PutRecord.Latency", "StreamName", "${StreamName}", { "id": "m8", "visible": true }]
              ],
              "region": `${this.region}`,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "stat": "Average",
              "title": "PutRecord latency - average (Milliseconds)",
              "period": 60,
              "view": "timeSeries",
              "stacked": false
            }
          },
          {
            "type": "metric",
            "x": 6,
            "y": 12,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                ["AWS/Kinesis", "PutRecord.Success", "StreamName", "${StreamName}", { "id": "m9", "visible": true }]
              ],
              "region": `${this.region}`,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "stat": "Average",
              "title": "PutRecord success - average (Percent)",
              "period": 60,
              "view": "timeSeries",
              "stacked": false
            }
          },
          {
            "type": "metric",
            "x": 0,
            "y": 12,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                [{ "expression": "m10/1024/1024/PERIOD(m10)", "id": "e2", "label": "PutRecords - sum (MB/s)", "region": `${this.region}`, "period": 60 }],
                ["AWS/Kinesis", "PutRecords.Bytes", "StreamName", "${StreamName}", { "id": "m10", "visible": false, "stat": "Sum" }]
              ],
              "region": `${this.region}`,
              "yAxis": {
                "left": {
                  "min": 0,
                  "showUnits": false
                }
              },
              "title": "PutRecords - sum (MB/s)",
              "period": 60,
              "view": "timeSeries",
              "stacked": false,
              "stat": "Average"
            }
          },
          {
            "type": "metric",
            "x": 12,
            "y": 12,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                ["AWS/Kinesis", "PutRecords.Latency", "StreamName", "${StreamName}", { "id": "m11", "visible": true }]
              ],
              "region": `${this.region}`,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "stat": "Average",
              "title": "PutRecords latency - average (Milliseconds)",
              "period": 60,
              "view": "timeSeries",
              "stacked": false
            }
          },
          {
            "type": "metric",
            "x": 12,
            "y": 16,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                ["AWS/Kinesis", "WriteProvisionedThroughputExceeded", "StreamName", "${StreamName}", { "id": "m13", "visible": true }]
              ],
              "region": `${this.region}`,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "stat": "Average",
              "title": "Write throughput exceeded - average (Count)",
              "period": 60,
              "view": "timeSeries",
              "stacked": false
            }
          },
          {
            "type": "metric",
            "x": 0,
            "y": 16,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                [{ "expression": "(m11/m12) * 100", "id": "e3", "label": "PutRecords successful records - average (Percent)", "region": `${this.region}`, "period": 60 }],
                ["AWS/Kinesis", "PutRecords.SuccessfulRecords", "StreamName", "${StreamName}", { "id": "m11", "visible": false }],
                [".", "PutRecords.TotalRecords", ".", ".", { "id": "m12", "visible": false }]
              ],
              "region": `${this.region}`,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "title": "PutRecords successful records - average (Percent)",
              "period": 60,
              "view": "timeSeries",
              "stacked": false,
              "stat": "Sum"
            }
          },
          {
            "type": "metric",
            "x": 6,
            "y": 16,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                [{ "expression": "(m13/m12) * 100", "id": "e4", "label": "PutRecords failed records - average (Percent)", "region": `${this.region}`, "period": 60 }],
                ["AWS/Kinesis", "PutRecords.FailedRecords", "StreamName", "${StreamName}", { "id": "m13", "visible": false }],
                [".", "PutRecords.TotalRecords", ".", ".", { "id": "m12", "visible": false }]
              ],
              "region": `${this.region}`,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "title": "PutRecords failed records - average (Percent)",
              "period": 60,
              "view": "timeSeries",
              "stacked": false,
              "stat": "Sum"
            }
          },
          {
            "type": "metric",
            "x": 18,
            "y": 12,
            "width": 6,
            "height": 4,
            "properties": {
              "metrics": [
                [{ "expression": "(m15/m12) * 100", "id": "e5", "label": "PutRecords throttled records - average (Percent)", "region": `${this.region}`, "period": 60 }],
                ["AWS/Kinesis", "PutRecords.ThrottledRecords", "StreamName", "${StreamName}", { "id": "m15", "visible": false }],
                [".", "PutRecords.TotalRecords", ".", ".", { "id": "m12", "visible": false }]
              ],
              "region": `${this.region}`,
              "yAxis": {
                "left": {
                  "min": 0
                }
              },
              "title": "PutRecords throttled records - average (Percent)",
              "period": 60,
              "view": "timeSeries",
              "stacked": false,
              "stat": "Sum"
            }
          }
        ],
        variables: [
          {
            type: "property",
            property: "InstanceId",
            inputType: "input",
            id: "InstanceId",
            label: "InstanceId",
            visible: true
          },
          {
            type: "property",
            property: "StreamName",
            inputType: "input",
            id: "StreamName",
            label: "StreamName",
            visible: true
          }
        ]
      })
    });

    // Output the dashboard URL
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
      description: 'URL for the CloudWatch Dashboard',
    });
  }
}

const app = new cdk.App();
const stack = new KinesisLoadTestingWithLocustStack(app, "KinesisLoadTestingWithLocustStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});

cdk.Tags.of(stack).add("Project", "Kinesis Load Testing with Locust");
cdk.Tags.of(stack).add("origin", "aws-samples/kinesis-load-testing-with-locust");
