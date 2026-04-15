export type FeedbackQuestionType = 'star' | 'emoji' | 'choice' | 'text'

export interface FeedbackQuestion {
  id: string
  question: string
  type: FeedbackQuestionType
  /** Options for 'choice' type */
  options: string[]
  orderIndex: number
  isEnabled: boolean
  isRequired: boolean
  createdAt: string
  /**
   * Conditional display — only show this question when a prior question's answer matches.
   * dependsOnAnswerValue format:
   *   - choice questions: exact option string, e.g. "Long wait time"
   *   - star/emoji questions: score operator, e.g. "lte:2" | "gte:4" | "eq:3"
   */
  dependsOnQuestionId: string | null
  dependsOnAnswerValue: string | null
}

export interface FeedbackAnswerItem {
  questionId: string
  question: string
  type: FeedbackQuestionType
  /** Numeric score for star (1-5) and emoji (1-5) */
  score?: number
  /** Text value for choice and text types */
  value?: string
}

export interface FeedbackResponse {
  id: string
  submittedAt: string
  /** Optional category context — which service area the customer used */
  categoryId?: string
  categoryLabel?: string
  answers: FeedbackAnswerItem[]
}
