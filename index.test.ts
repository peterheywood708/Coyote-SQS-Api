import { describe, expect, test, beforeEach, jest } from "@jest/globals";

type Handler = (req: any, res: any) => Promise<any> | any;
const routes: Array<{ method: string; path: string; handler: Handler }> = [];
const middleware: any[] = [];
const listenMock = jest.fn((port: string, cb: () => void) => {
  cb();
  return { close: jest.fn() };
});

const appMock = {
  use: jest.fn((fn: any) => {
    middleware.push(fn);
    return appMock;
  }),
  get: jest.fn((path: string, handler: Handler) => {
    routes.push({ method: "get", path, handler });
    return appMock;
  }),
  post: jest.fn((path: string, handler: Handler) => {
    routes.push({ method: "post", path, handler });
    return appMock;
  }),
  listen: listenMock,
};

const expressMock = jest.fn(() => appMock);
const verifyMock = jest.fn();
const sendMessagePromiseMock = jest.fn();
const receiveMessagePromiseMock = jest.fn();
const deleteMessagePromiseMock = jest.fn();

const sqsInstance = {
  sendMessage: jest.fn(() => ({ promise: sendMessagePromiseMock })),
  receiveMessage: jest.fn(() => ({ promise: receiveMessagePromiseMock })),
  deleteMessage: jest.fn(() => ({ promise: deleteMessagePromiseMock })),
};

jest.mock("express", () => ({
  __esModule: true,
  default: expressMock,
}));

jest.mock("cors", () =>
  jest.fn(() => (req: any, res: any, next: any) => next()),
);
jest.mock("body-parser", () => ({
  __esModule: true,
  json: jest.fn(() => (req: any, res: any, next: any) => next()),
  urlencoded: jest.fn(() => (req: any, res: any, next: any) => next()),
}));

jest.mock("aws-sdk", () => ({
  SQS: jest.fn(() => sqsInstance),
}));

jest.mock("aws-jwt-verify", () => ({
  CognitoJwtVerifier: {
    create: jest.fn(() => ({ verify: verifyMock })),
  },
}));

beforeEach(() => {
  jest.resetModules();
  expressMock.mockClear();
  listenMock.mockClear();
  routes.length = 0;
  middleware.length = 0;
  verifyMock.mockReset();
  sendMessagePromiseMock.mockReset();
  receiveMessagePromiseMock.mockReset();
  deleteMessagePromiseMock.mockReset();
  sqsInstance.sendMessage.mockClear();
  sqsInstance.receiveMessage.mockClear();
  sqsInstance.deleteMessage.mockClear();
});

const loadApp = () => {
  process.env.AWS_QUEUE_URL = "https://sqs.example.com/queue";
  process.env.API_VERSION = "2012-11-05";
  process.env.COGNITO_USERPOOLID = "pool";
  process.env.COGNITO_CLIENTID = "client";
  process.env.PORT = "1234";
  require("./index");
};

describe("index.ts route configuration and handlers", () => {
  test("registers expected routes and starts listening", () => {
    loadApp();
    const registered = routes.map((route) => `${route.method} ${route.path}`);
    expect(registered).toEqual(
      expect.arrayContaining([
        "get /",
        "post /new",
        "get /receive",
        "post /delete",
      ]),
    );
    expect(listenMock).toHaveBeenCalledWith("1234", expect.any(Function));
  });

  test("GET / returns welcome text", async () => {
    loadApp();
    const route = routes.find(
      (route) => route.method === "get" && route.path === "/",
    );
    expect(route).toBeDefined();
    const send = jest.fn();
    await route!.handler({}, { send });
    expect(send).toHaveBeenCalledWith("Welcome to the SQS API");
  });

  test("POST /new returns 401 when authorization header is missing", async () => {
    loadApp();
    const route = routes.find(
      (route) => route.method === "post" && route.path === "/new",
    );
    expect(route).toBeDefined();
    const status = jest.fn().mockReturnThis();
    const send = jest.fn();
    await route!.handler(
      { header: jest.fn().mockReturnValue("") },
      { status, send },
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(send).toHaveBeenCalledWith("No authorization token provided");
  });

  test("POST /new sends SQS message for valid token and body", async () => {
    loadApp();
    const route = routes.find(
      (route) => route.method === "post" && route.path === "/new",
    );
    expect(route).toBeDefined();
    verifyMock.mockResolvedValue({ username: "test-user" });
    sendMessagePromiseMock.mockResolvedValue({ MessageId: "abc123" });
    const status = jest.fn().mockReturnThis();
    const send = jest.fn();
    const req = {
      header: jest.fn().mockReturnValue("token"),
      body: { key: "hello", jobId: "job-1" },
    };
    await route!.handler(req, { status, send });
    expect(verifyMock).toHaveBeenCalledWith("token");
    expect(sqsInstance.sendMessage).toHaveBeenCalledWith({
      QueueUrl: "https://sqs.example.com/queue",
      MessageBody: JSON.stringify({
        key: "hello",
        userId: "test-user",
        jobId: "job-1",
      }),
    });
    expect(send).toHaveBeenCalledWith({ MessageId: "abc123" });
  });
});
