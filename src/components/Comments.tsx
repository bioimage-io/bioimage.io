import React, { useState, useEffect } from 'react';
import { Comment, CommentsData } from '../types/comments';
import { useHyphaStore } from '../store/hyphaStore';
import { v4 as uuidv4 } from 'uuid';
import ReviewWriter from './ReviewWriter';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface CommentsProps {
  artifactId: string;
}

const markdownStyles = `
  .prose {
    font-size: 0.875rem;
  }
  .prose p {
    margin-top: 0.5em;
    margin-bottom: 0.5em;
  }
  .prose pre {
    background-color: #f3f4f6;
    padding: 0.5rem;
    border-radius: 0.375rem;
    overflow-x: auto;
  }
  .prose code {
    background-color: #f3f4f6;
    padding: 0.2em 0.4em;
    border-radius: 0.25rem;
    font-size: 0.875em;
  }
  .prose img {
    max-width: 100%;
    height: auto;
  }
  .prose a {
    color: #2563eb;
    text-decoration: underline;
  }
  .prose ul {
    list-style-type: disc;
    padding-left: 1.5em;
  }
  .prose ol {
    list-style-type: decimal;
    padding-left: 1.5em;
  }
  .prose blockquote {
    border-left: 4px solid #e5e7eb;
    padding-left: 1em;
    color: #6b7280;
  }
`;

const UserIcon: React.FC<{ userName: string }> = ({ userName }) => {
  const initials = userName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-medium text-sm">
      {initials}
    </div>
  );
};

const CommentItem: React.FC<{
  comment: Comment;
  onReply: (commentId: string) => void;
  replyTo: string | null;
  onCancelReply: () => void;
  onAddComment: (content: string, parentId?: string) => void;
  onEditComment: (commentId: string, content: string) => void;
  level?: number;
  isLastReply?: boolean;
  comments: Comment[];
}> = ({ comment, onReply, replyTo, onCancelReply, onAddComment, onEditComment, level = 0, isLastReply = false, comments }) => {
  const [newReply, setNewReply] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(comment.content);
  const { user } = useHyphaStore();

  const isCommentAuthor = user?.id === comment.userId;
  
  // Check if this is the last comment/reply from the current user
  const isLastUserComment = () => {
    if (!user) return false;

    if (level === 0) {
      // For top-level comments
      const userComments = comments.filter(c => c.userId === user.id);
      return userComments.length > 0 && userComments[userComments.length - 1].id === comment.id;
    } else {
      // For replies
      const parentComment = comments.find(c => c.id === comment.parentId);
      if (!parentComment?.replies) return false;
      const userReplies = parentComment.replies.filter(r => r.userId === user.id);
      return userReplies.length > 0 && userReplies[userReplies.length - 1].id === comment.id;
    }
  };

  const canEdit = isCommentAuthor && isLastUserComment();

  const handleSubmitEdit = async () => {
    if (!editedContent.trim()) return;
    setIsSubmitting(true);
    await onEditComment(comment.id, editedContent);
    setIsSubmitting(false);
    setIsEditing(false);
  };

  const handleSubmitReply = async () => {
    if (!newReply.trim()) return;
    setIsSubmitting(true);
    await onAddComment(newReply, comment.parentId || comment.id);
    setNewReply('');
    setIsSubmitting(false);
  };

  const showReplyButton = 
    (level === 0 && (!comment.replies || comment.replies.length === 0)) || // Show on top level only if no replies
    (level === 1 && isLastReply); // Show on the last reply in a thread

  const isReplyBoxVisible = replyTo === comment.id;

  return (
    <div className="bg-white rounded-lg p-2 group">
      <div className="flex gap-2">
        <UserIcon userName={comment.userName} />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{comment.userName}</span>
              <span className="text-gray-500 text-xs">
                {new Date(comment.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              {canEdit && (
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="text-gray-500 text-xs hover:text-gray-700 flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </button>
              )}
              {showReplyButton && (
                <button
                  onClick={() => onReply(comment.id)}
                  className="text-blue-600 text-xs hover:text-blue-700 flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                  Reply
                </button>
              )}
            </div>
          </div>

          {isEditing ? (
            <div className="mt-1">
              <textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                className="w-full min-h-[60px] p-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditedContent(comment.content);
                  }}
                  className="px-3 py-1 text-xs text-gray-600 hover:text-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitEdit}
                  disabled={!editedContent.trim() || editedContent === comment.content}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-0.5 text-sm text-gray-700">
              <ReactMarkdown 
                className="prose"
                remarkPlugins={[remarkGfm]}
              >
                {comment.content}
              </ReactMarkdown>
            </div>
          )}

          {/* Replies */}
          {level === 0 && comment.replies && comment.replies.length > 0 && (
            <div className="ml-2 mt-2 space-y-2 border-l border-gray-100 pl-2">
              {comment.replies.map((reply, index) => (
                <CommentItem 
                  key={reply.id} 
                  comment={{...reply, parentId: comment.id}}
                  onReply={onReply}
                  replyTo={replyTo}
                  onCancelReply={onCancelReply}
                  onAddComment={onAddComment}
                  onEditComment={onEditComment}
                  level={1}
                  isLastReply={index === comment.replies?.length - 1}
                  comments={comments}
                />
              ))}
            </div>
          )}

          {/* Reply input box */}
          {isReplyBoxVisible && (
            <div className="mt-3 bg-gray-50 rounded-lg p-3">
              {isSubmitting ? (
                <div className="flex justify-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <>
                  <div className="flex items-center mb-2">
                    <span className="text-xs text-gray-500">
                      Replying to {comment.userName}
                    </span>
                    <button
                      onClick={onCancelReply}
                      className="ml-2 text-xs text-red-600 hover:text-red-700"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-shrink-0">
                      {user && <UserIcon userName={user.name || user.id} />}
                    </div>
                    <div className="flex-1 flex flex-col gap-3">
                      <textarea
                        value={newReply}
                        onChange={(e) => setNewReply(e.target.value)}
                        placeholder="Write a reply..."
                        className="w-full min-h-[80px] p-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <div className="flex justify-end">
                        <button
                          onClick={handleSubmitReply}
                          disabled={!newReply.trim()}
                          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                          </svg>
                          Reply
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Comments: React.FC<CommentsProps> = ({ artifactId }) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { artifactManager, user } = useHyphaStore();
  const [isLoading, setIsLoading] = useState(true);
  const [showReviewWriter, setShowReviewWriter] = useState(false);

  useEffect(() => {
    loadComments();
  }, [artifactId]);

  const loadComments = async () => {
    if (!artifactManager) return;

    try {
      // Try to get comments.json
      const url = await artifactManager.get_file({
        artifact_id: artifactId,
        file_path: 'comments.json',
        version: 'stage',
        _rkwargs: true
      });

      const response = await fetch(url);
      if (response.ok) {
        const data: CommentsData = await response.json();
        setComments(data.comments);
      }
    } catch (error) {
      // File might not exist yet, which is fine
      console.log('No comments file found');
    } finally {
      setIsLoading(false);
    }
  };

  const saveComments = async (updatedComments: Comment[]) => {
    if (!artifactManager) return;

    const commentsData: CommentsData = {
      comments: updatedComments,
      lastUpdated: new Date().toISOString()
    };

    try {
      // Get presigned URL for upload
      const presignedUrl = await artifactManager.put_file({
        artifact_id: artifactId,
        file_path: 'comments.json',
        _rkwargs: true
      });

      // Upload the comments
      await fetch(presignedUrl, {
        method: 'PUT',
        body: JSON.stringify(commentsData, null, 2),
        headers: {
          'Content-Type': '' // workaround for s3
        }
      });

      setComments(updatedComments);
    } catch (error) {
      console.error('Error saving comments:', error);
    }
  };

  const addComment = async (content: string, parentId?: string) => {
    if (!content.trim() || !user) return;

    setIsSubmitting(true);
    
    const comment: Comment = {
      id: uuidv4(),
      content: content,
      userId: user.id,
      userName: user.name || user.id,
      createdAt: new Date().toISOString(),
      parentId: parentId
    };

    const updatedComments = [...comments];
    if (parentId) {
      const parentComment = updatedComments.find(c => c.id === parentId);
      if (parentComment) {
        parentComment.replies = [...(parentComment.replies || []), comment];
      }
    } else {
      updatedComments.push(comment);
    }

    await saveComments(updatedComments);
    setNewComment('');
    setReplyTo(null);
    setIsSubmitting(false);
  };

  const editComment = async (commentId: string, newContent: string) => {
    if (!user) return;

    const updatedComments = [...comments];
    let commentToUpdate: Comment | undefined;

    // Search in top-level comments
    commentToUpdate = updatedComments.find(c => c.id === commentId);
    
    // If not found, search in replies
    if (!commentToUpdate) {
      for (const comment of updatedComments) {
        if (comment.replies) {
          commentToUpdate = comment.replies.find(r => r.id === commentId);
          if (commentToUpdate) break;
        }
      }
    }

    if (commentToUpdate && commentToUpdate.userId === user.id) {
      commentToUpdate.content = newContent;
      await saveComments(updatedComments);
    }
  };

  // Add handler for review submission
  const handleReviewSubmit = (reviewComment: string) => {
    // Append the review comment to existing content with a newline
    setNewComment(prev => {
      const prefix = prev.trim() ? prev.trim() + '\n\n' : '';
      return prefix + reviewComment;
    });
    setShowReviewWriter(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading comments...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <style>{markdownStyles}</style>
      <div className="flex items-center gap-2 mb-4">
        {/* Add comment icon */}
        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
        </svg>
        <h3 className="text-lg font-medium text-gray-900">Comments</h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-2">
          {comments.length === 0 ? (
            <div className="text-center text-gray-500 py-4 text-sm">
              No comments yet. Be the first to comment!
            </div>
          ) : (
            <div className="space-y-2">
              {comments.map((comment) => (
                <CommentItem 
                  key={comment.id} 
                  comment={comment} 
                  onReply={(commentId) => setReplyTo(commentId)}
                  replyTo={replyTo}
                  onCancelReply={() => setReplyTo(null)}
                  onAddComment={addComment}
                  onEditComment={editComment}
                  comments={comments}
                />
              ))}
            </div>
          )}

          {/* Input box */}
          {!replyTo && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 mt-2">
              {isSubmitting ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <div className="flex-shrink-0">
                    {user && <UserIcon userName={user.name || user.id} />}
                  </div>
                  <div className="flex-1 flex flex-col gap-3">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Write a comment..."
                      className="w-full min-h-[80px] p-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <div className="flex justify-between">
                      {/* Review Helper Button */}
                      <button
                        onClick={() => setShowReviewWriter(true)}
                        className="px-4 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        Review Checklist
                      </button>

                      <button
                        onClick={() => addComment(newComment)}
                        disabled={!newComment.trim()}
                        className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                        Post
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add ReviewWriter dialog */}
      <ReviewWriter
        isOpen={showReviewWriter}
        onClose={() => setShowReviewWriter(false)}
        onSubmit={handleReviewSubmit}
      />
    </div>
  );
};

export default Comments; 