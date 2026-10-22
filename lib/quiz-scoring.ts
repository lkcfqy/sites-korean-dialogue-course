import {answerMatches} from "./study-records";
export function deadlinePassed(started:number,minutes:number,now:number){return now>=started+minutes*60_000;}
export function scoreQuiz(bank:{id:string;accepted:string[]}[],submitted:Record<string,string>){
  const answers=bank.map(q=>({id:q.id,correct:answerMatches(submitted[q.id]||"",q.accepted)}));
  return {answers,correct:answers.filter(a=>a.correct).length,total:bank.length,missing:bank.filter(q=>!submitted[q.id]?.trim()).length};
}
