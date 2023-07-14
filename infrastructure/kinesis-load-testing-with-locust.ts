import * as cdk from "aws-cdk-lib";
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
      maxAzs: 1,
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
      instanceType: InstanceType.of(InstanceClass.C7G, LOCUST_INSTANCE_SIZE),
      machineImage: MachineImage.latestAmazonLinux2({
        cpuType: AmazonLinuxCpuType.ARM_64,
      }),
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      userData: userData,
      init: initData,
    });

    new cdk.CfnOutput(this, "locust-dashboard-url", {
      value: `http://${locustLoadTestingInstance.instancePublicIp}:${LOCUST_DEFAULT_PORT}`,
    });
  }
}

const app = new cdk.App();
const stack = new KinesisLoadTestingWithLocustStack(app, "KinesisLoadTestingWithLocustStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});

cdk.Tags.of(stack).add("Project", "Kinesis Load Testing with Locust");
cdk.Tags.of(stack).add("origin", "aws-samples/kinesis-load-testing-with-locust");
