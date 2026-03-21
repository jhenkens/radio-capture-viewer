import type {
  SystemDTO,
  ChannelDTO,
  TransmissionDTO,
  PaginatedTransmissions,
} from "../../shared/types";

const BASE = "/api";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getSystems(): Promise<SystemDTO[]> {
    return request<SystemDTO[]>("/systems");
  },

  getChannels(systemId: string): Promise<ChannelDTO[]> {
    return request<ChannelDTO[]>(`/systems/${systemId}/channels`);
  },

  getTransmissions(params: {
    system_id: string;
    channel_ids?: string[];
    search?: string;
    cursor?: number;
    limit?: number;
    direction?: "before" | "after";
  }): Promise<PaginatedTransmissions> {
    const q = new URLSearchParams();
    q.set("system_id", params.system_id);
    if (params.channel_ids?.length) q.set("channel_ids", params.channel_ids.join(","));
    if (params.search) q.set("search", params.search);
    if (params.cursor != null) q.set("cursor", String(params.cursor));
    if (params.limit != null) q.set("limit", String(params.limit));
    if (params.direction) q.set("direction", params.direction);
    return request<PaginatedTransmissions>(`/transmissions?${q.toString()}`);
  },

  getTransmission(id: string): Promise<TransmissionDTO> {
    return request<TransmissionDTO>(`/transmissions/${id}`);
  },

  getAudioUrl(id: string): string {
    return `${BASE}/transmissions/${id}/audio`;
  },
};
