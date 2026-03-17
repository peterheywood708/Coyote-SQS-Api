import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import * as dotenv from "dotenv";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import AWS from "aws-sdk";

const cors = require("cors");
const app = express();
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
dotenv.config();

// Configuration of AWS
const sqs = new AWS.SQS({ apiVersion: process.env.API_VERSION });

// Verifier that expects valid access tokens:
const verifier = CognitoJwtVerifier.create({
  userPoolId: `${process.env.COGNITO_USERPOOLID}`,
  tokenUse: "access",
  clientId: `${process.env.COGNITO_CLIENTID}`,
});

const port: string = process.env.PORT || "3003";

interface IBody {
  key: string;
  userId: string;
  jobId: string;
}

app.get("/", (Request: Request, Response: Response) => {
  Response.send("Welcome to the SQS API");
});

app.post("/new", async (Request: Request, Response: Response) => {
  const token: string = Request.header("authorization") || "";
  const payload = await verifier.verify(token);
  if (payload) {
    if (Request.body?.key && Request.body?.jobId) {
      const messageBody: IBody = {
        key: Request.body?.key,
        userId: payload?.username,
        jobId: Request.body?.jobId,
      };
      const params = {
        QueueUrl: process.env.AWS_QUEUE_URL || "",
        MessageBody: JSON.stringify(messageBody),
      };
      try {
        const data = await sqs.sendMessage(params).promise();
        Response.send(data);
      } catch (err) {
        Response.status(400).send(err);
      }
    } else {
      Response.status(400).send("Body must include key, userId and jobId");
    }
  } else {
    Response.status(400).send("No authorisation token provided");
  }
});

app.get("/receive", async (Request: Request, Response: Response) => {
  // The below prevents caching so that messages from SQS are not recieved more than once
  Response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  const params = {
    QueueUrl: process.env.AWS_QUEUE_URL || "",
    MaxNumberOfMessages: 1,
    VisibilityTimeout: 3600,
    WaitTimeSeconds: 0,
  };
  try {
    const data = await sqs.receiveMessage(params).promise();
    Response.send(data.Messages || []);
  } catch (err) {
    Response.status(400).send(err);
  }
});

// Delete a SQS message
app.post("/delete", async (Request: Request, Response: Response) => {
  // The below prevents caching so that messages from SQS are not recieved more than once
  Response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  const params = {
    QueueUrl: process.env.AWS_QUEUE_URL || "",
    ReceiptHandle: Request.body?.ReceiptHandle,
  };
  try {
    const data = await sqs.deleteMessage(params).promise();
    Response.send();
  } catch (err) {
    Response.status(400).send(err);
  }
});

app.listen(port, () => {
  console.log(`SQS API running on port ${port}`);
});
