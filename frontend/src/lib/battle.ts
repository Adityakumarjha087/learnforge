"use client";
import { io, type Socket } from "socket.io-client";

export interface BattleQuestion {
  id: string;
  type: "MCQ" | "TRUE_FALSE";
  prompt: string;
  options: string[];
}
export interface BattleStart {
  battleId: string;
  opponent: { id: string; name: string; isBot: boolean };
  questions: BattleQuestion[];
  perQuestionMs: number;
}
export interface BattleEnd {
  battleId: string;
  winnerId: string | null;
  scores: Record<string, number>;
  xp: Record<string, number>;
  status: string;
}

export const wsUrl = () => process.env.NEXT_PUBLIC_WS_URL || (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:21001` : "");

export function connectBattle(token: string): Socket {
  return io(wsUrl(), { auth: { token }, transports: ["websocket", "polling"], reconnectionAttempts: 3 });
}
