export interface Metric {
  id: string;
  userId: string;
  recordedBy: string;
  name: string;
  unit: string | null;
  value: number;
  recordedDate: string;
  higherIsBetter: boolean;
  source: string | null;
  comment: string | null;
}

export interface MetricInput {
  name: string;
  unit: string | null;
  value: number;
  recorded_date: string;
  higher_is_better: boolean;
  source: string | null;
  comment: string | null;
}

export interface PersonalRecord {
  name: string;
  unit: string | null;
  value: number;
  recordedDate: string;
  higherIsBetter: boolean;
}

export interface MetricDto {
  id: string;
  user_id: string;
  recorded_by: string;
  name: string;
  unit: string | null;
  value: number;
  recorded_date: string;
  higher_is_better: boolean;
  source: string | null;
  comment: string | null;
}

export interface PersonalRecordDto {
  name: string;
  unit: string | null;
  value: number;
  recorded_date: string;
  higher_is_better: boolean;
}

export function mapMetricDto(dto: MetricDto): Metric {
  return {
    id: dto.id,
    userId: dto.user_id,
    recordedBy: dto.recorded_by,
    name: dto.name,
    unit: dto.unit,
    value: dto.value,
    recordedDate: dto.recorded_date,
    higherIsBetter: dto.higher_is_better,
    source: dto.source,
    comment: dto.comment,
  };
}

export function mapPersonalRecordDto(dto: PersonalRecordDto): PersonalRecord {
  return {
    name: dto.name,
    unit: dto.unit,
    value: dto.value,
    recordedDate: dto.recorded_date,
    higherIsBetter: dto.higher_is_better,
  };
}
