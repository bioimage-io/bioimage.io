import React, { useState, useEffect } from 'react';
import { Comment, CommentsData } from '../types/comments';
import { useHyphaStore } from '../store/hyphaStore';
import { v4 as uuidv4 } from 'uuid';

interface CommentsProps {
  artifactId: string;
}

const UserIcon: React.FC<{ userName: string }> = ({ userName }) => {
  const initials = userName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-medium">
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
  level?: number;
}> = ({ comment, onReply, replyTo, onCancelReply, onAddComment, level = 0 }) => {
  const [newReply, setNewReply] = useState('');
  const { user } = useHyphaStore();

  const handleSubmitReply = () => {
    if (!newReply.trim()) return;
    onAddComment(newReply, comment.id);
    setNewReply('');
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <div className="flex gap-4">
        <UserIcon userName={comment.userName} />
        <div className="flex-1">
          <div className="flex items-start justify-between">
            <div>
              <span className="font-medium">{comment.userName}</span>
              <span className="text-gray-500 text-sm ml-2">
                {new Date(comment.createdAt).toLocaleString()}
              </span>
            </div>
            {level < 2 && ( // Limit nesting to 2 levels
              <button
                onClick={() => onReply(comment.id)}
                className="text-blue-600 text-sm hover:text-blue-700 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                Reply
              </button>
            )}
          </div>
          <p className="mt-2 text-gray-700">{comment.content}</p>

          {/* Reply input box */}
          {replyTo === comment.id && (
            <div className="mt-4 bg-gray-50 rounded-lg p-4">
              <div className="flex items-center mb-2">
                <span className="text-sm text-gray-500">
                  Replying to {comment.userName}
                </span>
                <button
                  onClick={onCancelReply}
                  className="ml-2 text-sm text-red-600 hover:text-red-700"
                >
                  Cancel
                </button>
              </div>
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  {user && <UserIcon userName={user.name || user.id} />}
                </div>
                <div className="flex-1 flex flex-col gap-4">
                  <textarea
                    value={newReply}
                    onChange={(e) => setNewReply(e.target.value)}
                    placeholder="Write a reply..."
                    className="w-full min-h-[100px] p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={handleSubmitReply}
                      disabled={!newReply.trim()}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      Reply
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Replies */}
          {comment.replies && comment.replies.length > 0 && (
            <div className="ml-4 mt-4 space-y-4 border-l-2 border-gray-100 pl-4">
              {comment.replies.map((reply) => (
                <CommentItem 
                  key={reply.id} 
                  comment={reply} 
                  onReply={onReply}
                  replyTo={replyTo}
                  onCancelReply={onCancelReply}
                  onAddComment={onAddComment}
                  level={level + 1}
                />
              ))}
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
  const { artifactManager, user } = useHyphaStore();
  const [isLoading, setIsLoading] = useState(true);

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
      // Add as reply
      const parentComment = updatedComments.find(c => c.id === parentId);
      if (parentComment) {
        parentComment.replies = [...(parentComment.replies || []), comment];
      }
    } else {
      // Add as top-level comment
      updatedComments.push(comment);
    }

    await saveComments(updatedComments);
    setNewComment('');
    setReplyTo(null);
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
      {/* Comments section with input box */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {comments.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              No comments yet. Be the first to comment!
            </div>
          ) : (
            <div className="space-y-6">
              {comments.map((comment) => (
                <CommentItem 
                  key={comment.id} 
                  comment={comment} 
                  onReply={(commentId) => setReplyTo(commentId)}
                  replyTo={replyTo}
                  onCancelReply={() => setReplyTo(null)}
                  onAddComment={addComment}
                />
              ))}
            </div>
          )}

          {/* Input box - now part of the scrollable content */}
          {!replyTo && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mt-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  {user && <UserIcon userName={user.name || user.id} />}
                </div>
                <div className="flex-1 flex flex-col gap-4">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Write a comment..."
                    className="w-full min-h-[100px] p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => addComment(newComment)}
                      disabled={!newComment.trim()}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                      Post
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Comments; 