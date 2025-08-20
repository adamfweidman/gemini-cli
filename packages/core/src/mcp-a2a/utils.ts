/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  DataPart,
  FilePart,
  Message,
  Message1,
  Message2,
  Task,
  TextPart,
  SendMessageResponse,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
} from '@a2a-js/sdk';

export type A2AStreamEventData = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

export const textResponse = (message: string): CallToolResult => ({
  content: [
    {
      type: 'text',
      text: message,
    },
  ],
});

export function extractMessageText(
  message: Message | Message1 | Message2 | undefined,
): string {
  if (!message) {
    return '';
  }

  const textParts = message.parts
    .filter((p): p is TextPart => p.kind === 'text')
    .map((p) => p.text)
    .filter(Boolean);

  if (textParts.length > 0) {
    return textParts.join(' ');
  }

  const dataParts = message.parts
    .filter((p): p is DataPart => p.kind === 'data')
    .map((p) => p.data)
    .filter(Boolean);

  if (dataParts.length > 0) {
    const responses = dataParts.map((data) => `Data: ${JSON.stringify(data)}`);
    return responses.join('\n');
  }

  const fileParts = message.parts
    .filter((p): p is FilePart => p.kind === 'file')
    .filter(Boolean);

  if (fileParts.length > 0) {
    const files = fileParts.map((fp) => {
      const fileData = fp.file;
      if (fileData.name) {
        return `File: ${fileData.name}`;
      }
      if ('uri' in fileData) {
        return `File: ${fileData.uri}`;
      }
      if ('bytes' in fileData) {
        return `File: [unnamed file with bytes]`;
      }
      return '[unknown file part]';
    });
    return files.join('\n');
  }

  return '[unknown message part]';
}

export function extractTaskText(task: Task): string {
  let output = `ID:      ${task.id}\n`;
  output += `State:   ${task.status.state}\n`;
  const messageText = extractMessageText(task.status.message);
  if (messageText) {
    output += `Message: ${messageText}\n`;
  }

  // if (task.history && task.history.length > 0) {
  //   output += `\nHistory:\n ${task.history.length} messages\n`;
  // }

  return output;
}

export function extractContextId(
  sendMessageResponse: SendMessageResponse,
): string | undefined {
  if ('error' in sendMessageResponse) return undefined;
  return sendMessageResponse.result.contextId;
}

let i = 0

export function extractA2AEventStream(event: A2AStreamEventData): string {
  i++
  switch (event.kind) {
    case 'message':
      console.error("message", i, JSON.stringify(event))
      return `Message: ${extractMessageText(event)}`;
    case 'task':
      console.error("task", i, JSON.stringify(event))
      return `Task Update: ${extractTaskText(event)}`;
    case 'status-update':
      console.error("status-update", i, JSON.stringify(event))
      const text = extractMessageText(event.status.message);
      return `Status Update: ${text ? text : event.status.state}\n`;
    case 'artifact-update':
      console.error("artifact-update", i,  JSON.stringify(event))
      return `Artifact Update: ${event.artifact.name}\n`;
    default:
      return `Unknown event: ${JSON.stringify(event)}`;
  }
}
