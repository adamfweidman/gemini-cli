/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AgentCard,
  CancelTaskResponse,
  GetTaskResponse,
  MessageSendParams,
  SendMessageResponse,
  Message,
  Task,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  // SendStreamingMessageResponse
} from '@a2a-js/sdk';
import {
  A2AClient,
  A2AClientOptions,
  // AuthenticationHandler,
  // HttpHeaders,
  // AuthHandlingFetch,
} from '@a2a-js/sdk/client';
import { extractContextId } from './utils.js';
import { v4 as uuidv4 } from 'uuid';

// TODO remove, redefining
type A2AStreamEventData = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;


const AGENT_CARD_WELL_KNOWN_PATH = '/.well-known/agent-card.json';

/**
 * Manages the A2A client and caches loaded agent information.
 * Follows a singleton pattern to ensure a single client instance.
 */
export class A2AClientManager {
  private static instance: A2AClientManager;
  // TODO: unif these maps
  private registeredAgents = new Map<string, A2AClient>(); // { agentName : A2AClient}
  private taskMap = new Map<string, Set<string>>(); // { agentName : Set<>taskId} // TODO handle taskId completion
  private contextMap = new Map<string, string>(); // { agentName : contextId}

  /**
   * Gets the singleton instance of the A2AClientManager.
   */
  static getInstance(): A2AClientManager {
    if (!A2AClientManager.instance) {
      A2AClientManager.instance = new A2AClientManager();
    }
    console.error('created new A2AClientManager instance');
    return A2AClientManager.instance;
  }

  /**
   * Initializes the A2A client.
   */
  async initialize(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * InitializedFetches and caches an agent's card.
   * @param url The URL of the agent.
   * @returns The agent's card.
   */
  async loadAgent(
    url: string,
    agent_card_path?: string,
    token?: string,
  ): Promise<AgentCard> {
    console.error(`Loading agent from URL: ${url}`);

    const options: A2AClientOptions = {
      agentCardPath: agent_card_path || AGENT_CARD_WELL_KNOWN_PATH,
    };

    // Create a single, unified fetch wrapper to handle all header modifications.
    const customFetch: typeof fetch = (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const headers = new Headers(init?.headers);

      if (headers.get('Accept') === 'text/event-stream') {
        headers.set('Cache-Control', 'no-cache');
        headers.set('Connection', 'keep-alive');
      }

      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const newInit = { ...init, headers };

      // Convert Headers object to a plain object for accurate logging.
      const headersForLogging: Record<string, string> = {};
      headers.forEach((value, key) => {
        headersForLogging[key] = value;
      });
      console.error(
        'Final Fetch Init:',
        JSON.stringify({ ...newInit, headers: headersForLogging }, null, 2),
      );

      return fetch(input, newInit);
    };

    options.fetchImpl = customFetch;

    const a2aClient = new A2AClient(url, options);
    const agentCard = await a2aClient.getAgentCard();

    console.error('Loaded agent card:', JSON.stringify(agentCard));

    if (this.registeredAgents.has(agentCard.name)) {
      throw Error(`Agent with name ${agentCard.name} is already loaded.`);
    }

    this.registeredAgents.set(agentCard.name, a2aClient!);

    return agentCard;
  }

  /**
   * Lists all cached agent cards.
   * @returns An array of loaded agent cards.
   */
  async listAgents(): Promise<AgentCard[]> {
    console.error('Listing all registered agents.');
    const agentCardsPromises = Array.from(this.registeredAgents.values()).map(
      (agentClient) => agentClient.getAgentCard(),
    );
    // Wait for all the promises to resolve
    const agentCards = await Promise.all(agentCardsPromises);
    console.error('Returning agent cards:', agentCards);
    return agentCards;
  }

  /**
   * Connects to an agent and sends a message.
   * @param agentName The name of the agent.
   * @param message The message to send.
   * @returns The task representing the message exchange.
   */
  async sendMessage(
    agentName: string,
    message: string,
  ): Promise<SendMessageResponse> {
    const a2aClient = this.registeredAgents.get(agentName);
    if (!a2aClient) {
      throw new Error(
        `Agent with name ${agentName} is not registered. Please run load_agent first.`,
      );
    }

    const taskId = uuidv4(); // Generate a new taskId for the message
    this.taskMap.set(
      agentName,
      (this.taskMap.get(agentName) || new Set()).add(taskId),
    );

    // TODO: Support more than just text
    const messageParams: MessageSendParams = {
      message: {
        kind: 'message',
        role: 'user',
        messageId: uuidv4(),
        parts: [
          {
            kind: 'text',
            text: message,
          },
        ],
        taskId,
      },
    };

    const contextId = this.contextMap.get(agentName);
    if (contextId) messageParams.message.contextId = contextId;

    const response = await a2aClient.sendMessage(messageParams);
    const newContextId = extractContextId(response);
    if (newContextId) this.contextMap.set(agentName, newContextId);

    return response;
  }

  /**
   * Connects to an agent and sends a message, handling the streaming response.
   * @param agentName The name of the agent.
   * @param message The message to send.
   * @returns An async generator that yields events from the stream.
   */
  async *sendMessageStreaming(
    agentName: string,
    message: string,
  ): AsyncGenerator<A2AStreamEventData> {
    const a2aClient = this.registeredAgents.get(agentName);
    if (!a2aClient) {
      throw new Error(
        `Agent with name ${agentName} is not registered. Please run load_agent first.`,
      );
    }

    const taskId = uuidv4();
    this.taskMap.set(
      agentName,
      (this.taskMap.get(agentName) || new Set()).add(taskId),
    );

    const messageParams: MessageSendParams = {
      message: {
        kind: 'message',
        role: 'user',
        messageId: uuidv4(),
        parts: [
          {
            kind: 'text',
            text: message,
          },
        ],
        taskId,
      },
      configuration: {
        acceptedOutputModes: ['text'],
      }
    };

    console.error('messageParams', JSON.stringify(messageParams))

    const contextId = this.contextMap.get(agentName);
    if (contextId) messageParams.message.contextId = contextId;

    // TODO: This should be SendStreamingMessageResponse but it is A2AStreamEventData
    const stream = await a2aClient.sendMessageStream(messageParams);

    for await (const event of stream) {
      console.error("stream event", event)
      if (event) {
        const newContextId = event.contextId;
        if (newContextId) this.contextMap.set(agentName, newContextId);
      }
      yield event;
    }
  }

  /**
   * Retrieves a task by its ID.
   * @param taskId The ID of the task.
   * @returns The task object.
   */
  async getTask(agentName: string, taskId: string): Promise<GetTaskResponse> {
    const a2aClient = this.registeredAgents.get(agentName);
    if (!a2aClient) {
      throw new Error(
        `Agent with name ${agentName} is not registered. Please run load_agent first.`,
      );
    }

    if (!this.taskMap.get(agentName)?.has(taskId)) {
      throw new Error(
        `Agent with name ${agentName} has no task ${taskId} associated with it.`,
      );
    }

    return a2aClient.getTask({ id: taskId });
  }

  /**
   * Cancels a task by its ID.
   * @param taskId The ID of the task.
   */
  async cancelTask(
    agentName: string,
    taskId: string,
  ): Promise<CancelTaskResponse> {
    const a2aClient = this.registeredAgents.get(agentName);
    if (!a2aClient) {
      throw new Error(
        `Agent with name ${agentName} is not registered. Please run load_agent first.`,
      );
    }

    const agentTaskSet = this.taskMap.get(agentName);

    if (!agentTaskSet?.has(taskId)) {
      throw new Error(
        `Agent with name ${agentName} has no task ${taskId} associated with it.`,
      );
    }

    agentTaskSet.delete(taskId);

    return await a2aClient.cancelTask({ id: taskId });
  }
}

// // TODO: contribute this to a2a-js/sdk
// class StaticBearerTokenAuth implements AuthenticationHandler {
//   private token: string;

//   constructor(token: string) {
//     this.token = token;
//   }

//   headers(): HttpHeaders {
//     return {
//       Authorization: `Bearer ${this.token}`,
//     };
//   }

//   shouldRetryWithHeaders(
//     _req: RequestInit,
//     _res: Response,
//   ): Promise<HttpHeaders | undefined> {
//     return Promise.resolve(undefined);
//   }

//   onSuccess(_headers: HttpHeaders): Promise<void> {
//     return Promise.resolve();
//   }
// }
