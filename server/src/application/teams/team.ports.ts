export interface TeamRecord {
  id: string;
  name: string;
  description: string | null;
  leadId: string | null;
  leadName: string | null;
  memberCount: number;
  openTicketCount: number;
  createdAt: Date;
}

export interface TeamPatch {
  /** Verilmezse mevcut ad korunur. */
  name?: string | null;
  /** Verilmezse mevcut aciklama korunur. */
  description?: string | null;
  /** null: lideri kaldir; undefined: dokunma. */
  leadId?: string | null;
}

export interface TeamRepository {
  list(): Promise<TeamRecord[]>;
  findRecord(id: string): Promise<TeamRecord | null>;
  exists(id: string): Promise<boolean>;
  insert(team: { name: string; description: string | null; leadId: string | null }): Promise<string>;
  /** Ekip yoksa false doner. */
  update(id: string, patch: TeamPatch): Promise<boolean>;
  /** Ekip yoksa false doner. */
  delete(id: string): Promise<boolean>;
  hasOpenTickets(id: string): Promise<boolean>;
}
