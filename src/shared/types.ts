// DTOs shared between client and server (no DB types)

export interface SystemDTO {
  id: string;
  name: string;
  description: string | null;
  created_at: number;
}

export interface ChannelDTO {
  id: string;
  system_id: string;
  name: string;
  description: string | null;
  created_at: number;
}

export interface TransmissionDTO {
  id: string;
  system_id: string;
  channel_id: string;
  available: boolean;
  transcript: string | null;
  duration_ms: number | null;
  frequency_hz: number | null;
  recorded_at: number;
  created_at: number;
}

export interface TransmissionFileDTO {
  id: string;
  transmission_id: string;
  provider: string;
  path: string;
  size_bytes: number;
  created_at: number;
}

// WebSocket message types

export type ServerWSMessage =
  | { type: "subscribed" }
  | { type: "transmission_available"; data: TransmissionDTO }
  | { type: "query_result"; query_id: string; items: TransmissionDTO[]; next_cursor: number | null }
  | { type: "error"; message: string };

export type ClientWSMessage =
  | { type: "subscribe"; system_id: string; channel_ids?: string[] }
  | { type: "autoplay"; enabled: boolean; last_played_id?: string }
  | { type: "query"; query_id: string; system_id: string; channel_ids?: string[]; search?: string; cursor?: number; limit?: number };

// API response shapes

export interface PaginatedTransmissions {
  items: TransmissionDTO[];
  next_cursor: number | null;
}

export interface AdminStationResponse {
  system: { id: string; name: string };
  channels: { id: string; name: string }[];
}

export interface UploadInitiateResponse {
  upload_session_id: string;
  upload_url: string;
  transmission_id: string;
  expires_at: number;
}

export interface UploadCompleteResponse {
  transmission_id: string;
  status: "processing";
}

export interface UploadDirectResponse {
  transmission_id: string;
  status: "processing";
}
