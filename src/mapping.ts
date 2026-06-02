import type { MappingMode, NeckOrder, UrdfModel } from "./types";
import type { ParquetRow } from "./parquet";
import { ALLEX_STATE_SIZE, allex48Values } from "./allexMapping";

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function vectorFromUnknown(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const parsed = value.map(numberFromUnknown);
    return parsed.every((item): item is number => item !== null) ? parsed : null;
  }
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) return null;
    const view = value as unknown as ArrayLike<number>;
    return Array.from(view, Number);
  }
  if (value && typeof value === "object") {
    const candidate = value as { values?: unknown; list?: unknown; data?: unknown };
    return vectorFromUnknown(candidate.values ?? candidate.list ?? candidate.data);
  }
  return null;
}

function valuesFromNamedColumns(model: UrdfModel, row: ParquetRow): Record<string, number> {
  const values: Record<string, number> = {};
  model.joints.forEach((joint) => {
    const value = numberFromUnknown(row[joint.name]);
    if (value !== null) values[joint.name] = value;
  });
  return values;
}

function valuesFromStateVector(model: UrdfModel, row: ParquetRow, stateColumn: string): Record<string, number> {
  const vector = vectorFromUnknown(row[stateColumn]) ?? [];
  const values: Record<string, number> = {};
  model.movableJoints.forEach((joint, index) => {
    values[joint.name] = vector[index] ?? 0;
  });
  return values;
}

function valuesFromAllex48(row: ParquetRow, stateColumn: string, neckOrder: NeckOrder): Record<string, number> {
  const obs = vectorFromUnknown(row[stateColumn]) ?? [];
  return allex48Values(obs, neckOrder);
}

function shouldUseNamed(model: UrdfModel, row: ParquetRow): boolean {
  const namedCount = model.movableJoints.reduce((count, joint) => (row[joint.name] !== undefined ? count + 1 : count), 0);
  return namedCount >= Math.max(1, Math.floor(model.movableJoints.length * 0.4));
}

function shouldUseAllex(model: UrdfModel, row: ParquetRow, stateColumn: string): boolean {
  const vector = vectorFromUnknown(row[stateColumn]);
  return Boolean(vector && vector.length >= ALLEX_STATE_SIZE && model.jointsByName.has("Waist_Pitch_Upper_Joint") && model.jointsByName.has("R_Thumb_IP_Joint"));
}

export function detectMappingMode(model: UrdfModel, row: ParquetRow | undefined, stateColumn: string): Exclude<MappingMode, "auto"> {
  if (!row) return "state-vector";
  if (shouldUseNamed(model, row)) return "named";
  if (shouldUseAllex(model, row, stateColumn)) return "allex-48";
  return "state-vector";
}

export function jointValuesForFrame(
  model: UrdfModel,
  row: ParquetRow | undefined,
  mode: MappingMode,
  stateColumn: string,
  neckOrder: NeckOrder,
): Record<string, number> {
  if (!row) return {};
  const resolvedMode = mode === "auto" ? detectMappingMode(model, row, stateColumn) : mode;
  if (resolvedMode === "named") return valuesFromNamedColumns(model, row);
  if (resolvedMode === "allex-48") return valuesFromAllex48(row, stateColumn, neckOrder);
  return valuesFromStateVector(model, row, stateColumn);
}

export function availableColumns(row: ParquetRow | undefined): string[] {
  return row ? Object.keys(row) : [];
}
