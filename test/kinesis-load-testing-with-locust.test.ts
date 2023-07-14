import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { KinesisLoadTestingWithLocustStack } from "../infrastructure/kinesis-load-testing-with-locust";


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
