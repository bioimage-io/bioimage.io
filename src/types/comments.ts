export interface Comment {
  id: string;
  content: string;
  userId: string;
  userName: string;
  createdAt: string;
  parentId?: string;
  replies?: Comment[];
}

export interface CommentsData {
  comments: Comment[];
  lastUpdated: string;
} 