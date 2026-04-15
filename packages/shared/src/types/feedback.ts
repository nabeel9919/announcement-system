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
