import type { SystemDTO, ChannelDTO } from "../../shared/types";

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

  getAudioUrl(id: string): string {
    return `${BASE}/transmissions/${id}/audio`;
  },
};
