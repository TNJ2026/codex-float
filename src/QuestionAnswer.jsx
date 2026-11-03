import React from 'react';

export function QuestionAnswer({answers}){
 return <div className="markdown question-answer">{answers.map((reply,index)=><div className="question-answer-item" key={reply.questionItemId||index}>
  <div className="question-answer-question" title={reply.question}>{reply.question}</div>
  <div className="question-answer-content">{reply.answer}</div>
 </div>)}</div>;
}
