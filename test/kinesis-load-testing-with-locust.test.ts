import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Template } from "aws-cdk-lib/assertions";
import { KinesisLoadTestingWithLocustStack } from "../infrastructure/kinesis-load-testing-with-locust";
import { Construct } from "constructs";


jest.mock("aws-cdk-lib/aws-ec2", () => {
  const ec2 = jest.requireActual("aws-cdk-lib/aws-ec2");

  return {
    ...ec2,
    Vpc: {
        fromLookup: (scope: Construct, id: string, props?: ec2.VpcProps) => new ec2.Vpc(scope, id, props)
      },
  }
});

test("KinesisLoadTestingWithLocustStack Snapshot test", () => {
    const app = new cdk.App();
    // WHEN
  const stack = new KinesisLoadTestingWithLocustStack(app, "KinesisLoadTestingWithLocustStack", {
    env: {
      region: "eu-central-1",
    },
  });
  // THEN
  const template = Template.fromStack(stack);
  expect(template).toMatchSnapshot();
});
