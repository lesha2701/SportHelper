export interface TaskTemplateExercise {
  id: string;
  templateId: string;
  exerciseId: string;
  exerciseName: string | null;
  orderIndex: number;
}

export interface TaskTemplate {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  planId: string | null;
  metricName: string | null;
  metricUnit: string | null;
  metricTarget: number | null;
  requireComment: boolean;
  requirePhoto: boolean;
  requireVideo: boolean;
  requireSetsReps: boolean;
  requireDuration: boolean;
  requireMetricValue: boolean;
  requireDifficulty: boolean;
  requireWellbeing: boolean;
  exercises: TaskTemplateExercise[];
}

export interface TaskTemplateInput {
  title: string;
  description: string | null;
  plan_id: string | null;
  exercise_ids: string[];
  metric_name: string | null;
  metric_unit: string | null;
  metric_target: number | null;
  require_comment: boolean;
  require_photo: boolean;
  require_video: boolean;
  require_sets_reps: boolean;
  require_duration: boolean;
  require_metric_value: boolean;
  require_difficulty: boolean;
  require_wellbeing: boolean;
}

export interface TaskTemplateExerciseDto {
  id: string;
  template_id: string;
  exercise_id: string;
  exercise_name: string | null;
  order_index: number;
}

export interface TaskTemplateDto {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  plan_id: string | null;
  metric_name: string | null;
  metric_unit: string | null;
  metric_target: number | null;
  require_comment: boolean;
  require_photo: boolean;
  require_video: boolean;
  require_sets_reps: boolean;
  require_duration: boolean;
  require_metric_value: boolean;
  require_difficulty: boolean;
  require_wellbeing: boolean;
  exercises: TaskTemplateExerciseDto[];
}

export function mapTaskTemplateExerciseDto(dto: TaskTemplateExerciseDto): TaskTemplateExercise {
  return {
    id: dto.id,
    templateId: dto.template_id,
    exerciseId: dto.exercise_id,
    exerciseName: dto.exercise_name,
    orderIndex: dto.order_index,
  };
}

export function mapTaskTemplateDto(dto: TaskTemplateDto): TaskTemplate {
  return {
    id: dto.id,
    ownerId: dto.owner_id,
    title: dto.title,
    description: dto.description,
    planId: dto.plan_id,
    metricName: dto.metric_name,
    metricUnit: dto.metric_unit,
    metricTarget: dto.metric_target,
    requireComment: dto.require_comment,
    requirePhoto: dto.require_photo,
    requireVideo: dto.require_video,
    requireSetsReps: dto.require_sets_reps,
    requireDuration: dto.require_duration,
    requireMetricValue: dto.require_metric_value,
    requireDifficulty: dto.require_difficulty,
    requireWellbeing: dto.require_wellbeing,
    exercises: dto.exercises.map(mapTaskTemplateExerciseDto),
  };
}
