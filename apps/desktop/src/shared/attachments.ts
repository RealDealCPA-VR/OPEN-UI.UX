export interface ChatAttachmentImage {
  kind: 'image';
  name: string;
  path: string;
  mimeType: string;
  data: string;
  sizeBytes: number;
}

export interface ChatAttachmentText {
  kind: 'text';
  name: string;
  path: string;
  mimeType: string;
  text: string;
  truncated: boolean;
  sizeBytes: number;
}

export interface ChatAttachmentBinary {
  kind: 'binary';
  name: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
}

export type ChatAttachment = ChatAttachmentImage | ChatAttachmentText | ChatAttachmentBinary;

export interface PrepareAttachmentsRequest {
  paths: string[];
}

export interface PrepareAttachmentsResponse {
  prepared: ChatAttachment[];
  errors: Array<{ path: string; message: string }>;
}

export const ATTACHMENT_TEXT_BYTE_LIMIT = 200 * 1024;
export const ATTACHMENT_IMAGE_BYTE_LIMIT = 10 * 1024 * 1024;
