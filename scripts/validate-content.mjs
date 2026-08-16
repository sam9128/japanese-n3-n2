import fs from "node:fs";
import path from "node:path";
import {READING_FORMATS,LISTENING_FORMATS,readingFormatFor,listeningFormatFor} from "./source/jlpt-formats.mjs";
const root=path.resolve(import.meta.dirname,"..","public","content");
const index=JSON.parse(fs.readFileSync(path.join(root,"index.json"),"utf8"));
const packs=index.periods.map(period=>JSON.parse(fs.readFileSync(path.join(root,"periods",`${period}.json`),"utf8")));
const all={vocabulary:[],grammar:[],reading:[],listening:[],assessments:[]};
for(const pack of packs)for(const key of Object.keys(all))all[key].push(...pack[key]);
const expected={vocabulary:4000,grammar:240,reading:52,listening:104};
for(const [key,count] of Object.entries(expected))if(all[key].length!==count)throw new Error(`${key}: ${all[key].length} !== ${count}`);
if(all.assessments.filter(x=>x.kind==="monthly").length!==12)throw new Error("monthly checks count mismatch");
if(all.assessments.filter(x=>x.kind==="mock"&&x.level==="N3").length!==5)throw new Error("N3 mock count mismatch");
if(all.assessments.filter(x=>x.kind==="mock"&&x.level==="N2").length!==2)throw new Error("N2 mock count mismatch");
const ids=Object.values(all).flat().map(x=>x.id);if(new Set(ids).size!==ids.length)throw new Error("duplicate IDs");
if(new Set(all.grammar.map(x=>x.term)).size<200)throw new Error("grammar unique patterns under 200");
for(const item of Object.values(all).flat())if(!item.sourceRefs?.length||!item.license)throw new Error(`missing source/license: ${item.id}`);
const hasChinese=(value)=>/[\u3400-\u9fff]/.test(value||"");
for(const card of [...all.vocabulary,...all.grammar]){
  if(!hasChinese(card.meaningZh))throw new Error(`missing Chinese meaning: ${card.id}`);
  if(!hasChinese(card.usageZh))throw new Error(`missing Chinese usage explanation: ${card.id}`);
  const example=card.examples?.[0];
  if(!hasChinese(example?.zh)||example.zh===example.ja||/^(中文解析|英)[：:]/.test(example.zh||""))throw new Error(`missing literal Chinese example translation: ${card.id}`);
  if(!hasChinese(example?.explanationZh))throw new Error(`missing Chinese example explanation: ${card.id}`);
}
if(all.vocabulary.some(card=>/^英[：:]/.test(card.meaningZh)))throw new Error("English-only vocabulary meaning detected");
const grammarExamples=all.grammar.map(card=>card.examples?.[0]?.ja);
if(new Set(grammarExamples).size!==240)throw new Error(`grammar examples are not unique: ${new Set(grammarExamples).size}/240`);
for(const card of all.grammar){
  if(!card.examples?.[0]?.ja||card.examples[0].ja.includes("〜"))throw new Error(`invalid grammar example: ${card.id}`);
  const expectedAudio=card.term.replace(/[〜～]/g, "").replace(/[（(][^）)]*[）)]/g, "").trim();
  if(card.audioText!==expectedAudio)throw new Error(`grammar audio does not match pattern: ${card.id}`);
  if(card.audioText===card.examples[0].ja)throw new Error(`grammar pattern audio duplicates example: ${card.id}`);
}
for(const card of all.vocabulary){
  if(!card.sourceRefs.includes(`https://www.sigure.tw/learn-japanese/vocabulary/${card.level.toLowerCase()}/`))throw new Error(`missing Sigure vocabulary reference: ${card.id}`);
  if(!card.referenceNoteZh?.includes("不轉載")&&!card.referenceNoteZh?.includes("未轉載"))throw new Error(`missing vocabulary reference disclaimer: ${card.id}`);
}
for(const card of all.grammar){
  if(!card.sourceRefs.includes(`https://www.sigure.tw/learn-japanese/grammar/${card.level.toLowerCase()}/`))throw new Error(`missing Sigure grammar reference: ${card.id}`);
  // The note used to be required to start with the boilerplate prefix 主要接續：.
    // Notes are written per pattern now, so require substance instead of a prefix.
    if(!card.usageZh||card.usageZh.length<15||!/接續|接在|形|＋/.test(card.usageZh))throw new Error(`grammar connection note missing: ${card.id}`);
  if(!card.referenceNoteZh?.includes("自編"))throw new Error(`missing grammar reference disclaimer: ${card.id}`);
}
// The N3 sitting is 115/12/06 and the five N3 mocks run in 115/11\u201312. Reading and
// listening used to spread evenly across all twelve months regardless of level,
// so N3 material was still being released in 116-02 \u2014 after the exam, and after
// the mocks that needed it, which left the last N3 mocks short of source
// questions. Both halves of the year must hold their own level.
{
  const n3End=index.periods.indexOf("115-12");
  for(const item of [...all.reading,...all.listening]){
    const at=index.periods.indexOf(item.unlockPeriod);
    if(item.level==="N3"&&at>n3End)throw new Error(`N3 material released after the N3 exam: ${item.id} (${item.unlockPeriod})`);
    if(item.level==="N2"&&at<=n3End)throw new Error(`N2 material released in the N3 half: ${item.id} (${item.unlockPeriod})`);
  }
}

// A mock is meant to simulate the real sitting, so its section balance has to
// match the real paper. Monthly checks are progress checks and deliberately run
// lighter on \u8aad\u89e3/\u8074\u89e3, so they are not held to this.
{
  const realShare={N3:{"\u6587\u5b57\u30fb\u8a9e\u5f59":0.34,"\u6587\u6cd5":0.23,"\u8aad\u89e3":0.16,"\u8074\u89e3":0.27},N2:{"\u6587\u5b57\u30fb\u8a9e\u5f59":0.30,"\u6587\u6cd5":0.21,"\u8aad\u89e3":0.20,"\u8074\u89e3":0.29}};
  const order=["\u6587\u5b57\u30fb\u8a9e\u5f59","\u6587\u6cd5","\u8aad\u89e3","\u8074\u89e3"];
  for(const exam of all.assessments.filter(x=>x.kind==="mock")){
    const counts={};
    for(const question of exam.questions)counts[question.section]=(counts[question.section]||0)+1;
    for(const [section,share] of Object.entries(realShare[exam.level])){
      const actual=(counts[section]||0)/exam.questions.length;
      if(Math.abs(actual-share)>0.04)throw new Error(`mock section share off: ${exam.id} ${section} ${(actual*100).toFixed(0)}% vs ${(share*100).toFixed(0)}%`);
    }
    // A real paper groups its sections; it does not alternate one question at a time.
    const seen=exam.questions.map(q=>order.indexOf(q.section));
    for(let i=1;i<seen.length;i+=1)if(seen[i]<seen[i-1])throw new Error(`exam sections are not in paper order: ${exam.id} at question ${i+1}`);
  }
}

const hasJapanese=(value)=>/[\u3040-\u30ff\u3400-\u9fff]/.test(value||"");
const hasChineseMarker=(value)=>/[這裡讓應嗎們]|下午|上午|二樓|選項|答案|中文|直接放棄|身邊的人/.test(value||"");
const sourceQuestions=new Map();
const awkwardPatterns=[/するください/,/するもらえ/,/事前に前日まで/,/までに前日まで/,/早めに前日まで/];
// The service worker drops its cached lesson packs when this changes, which is
// how a rebuild reaches the learner on their first visit. If it ever goes
// missing the worker silently falls back to the hand-written contentVersion,
// which is exactly the field that failed to move through a full rebuild.
if(!/^[0-9a-f]{16}$/.test(index.contentHash||""))throw new Error(`index.contentHash missing or malformed: ${index.contentHash}`);
if(new Set(all.reading.map(item=>item.content)).size!==52)throw new Error("reading passages are not all unique");
if(new Set(all.reading.map(item=>item.headline)).size!==52)throw new Error("reading titles are not all unique");
for(const item of all.reading){
  if(!item.jlptFormat||!item.jlptType||!item.formatLabelZh||!item.headline||!item.dateline)throw new Error(`JLPT format metadata missing: ${item.id}`);
  if(!item.summaryPromptZh||!item.sourceNoteZh?.includes("自編")||!item.sourceNoteZh?.includes("並非"))throw new Error(`authorship notice missing: ${item.id}`);
  if(!item.sourceRefs.includes("https://www.sigure.tw/quiz/reading/medium/"))throw new Error(`reading reference missing: ${item.id}`);
}
if(new Set(all.listening.map(item=>item.audioText)).size!==104)throw new Error("listening scripts are not all unique");

// Per-大問 counts, question counts and script lengths, so the JLPT structure
// cannot quietly collapse back into one undifferentiated format.
const readingByFormat=new Map();
for(const item of all.reading)readingByFormat.set(item.jlptFormat,(readingByFormat.get(item.jlptFormat)||0)+1);
for(const format of READING_FORMATS){
  if(readingByFormat.get(format.key)!==format.count)throw new Error(`reading 大問 count mismatch: ${format.jlpt} ${readingByFormat.get(format.key)}/${format.count}`);
}
const listeningByFormat=new Map();
for(const item of all.listening)listeningByFormat.set(item.jlptFormat,(listeningByFormat.get(item.jlptFormat)||0)+1);
for(const format of LISTENING_FORMATS){
  if(listeningByFormat.get(format.key)!==format.count)throw new Error(`listening 大問 count mismatch: ${format.jlpt} ${listeningByFormat.get(format.key)}/${format.count}`);
}

// The defect this whole rebuild was about: 52 reading passages used to show the
// learner four distinct question wordings all year. Cap how much any one stem
// may dominate so that can never come back unnoticed.
for(const [label,items,minStems,maxShare] of [["reading",all.reading,20,0.2],["listening",all.listening,18,0.25]]){
  const questions=items.flatMap(item=>item.questions);
  const stems=new Map();
  for(const question of questions)stems.set(question.prompt,(stems.get(question.prompt)||0)+1);
  if(stems.size<minStems)throw new Error(`${label} question stems too repetitive: ${stems.size} distinct across ${questions.length} questions`);
  const worst=[...stems.entries()].sort((a,b)=>b[1]-a[1])[0];
  if(worst[1]/questions.length>maxShare)throw new Error(`${label} stem overused: 「${worst[0]}」 ${worst[1]}/${questions.length}`);
}

for(const item of [...all.reading,...all.listening]){
  const sourceText=item.category==="reading"?item.content:item.audioText;
  if(awkwardPatterns.some(pattern=>pattern.test(sourceText)))throw new Error(`unnatural Japanese construction: ${item.id}`);
  const format=item.category==="reading"?readingFormatFor(item.jlptFormat):listeningFormatFor(item.jlptFormat);
  if(!format)throw new Error(`unknown JLPT format: ${item.id} ${item.jlptFormat}`);
  if(item.questions?.length!==format.questions)throw new Error(`source question count mismatch: ${item.id} (${item.questions?.length}, ${format.jlpt} expects ${format.questions})`);
  if(item.category==="reading"){
    const length=[...item.content].length;
    if(length<format.chars[0]||length>format.chars[1])throw new Error(`passage length out of band: ${item.id} ${length} not in ${format.chars}`);
  }
  if(item.category==="listening"){
    if(item.lines?.length<format.lines[0]||item.lines?.length>format.lines[1])throw new Error(`listening line count out of band: ${item.id} ${item.lines?.length} not in ${format.lines}`);
    if(item.audioText!==item.lines.join(" "))throw new Error(`listening lines mismatch: ${item.id}`);
  }
  for(const question of item.questions){
    if(!question.id||sourceQuestions.has(question.id))throw new Error(`duplicate source question ID: ${question.id}`);
    if(!hasJapanese(question.prompt))throw new Error(`non-Japanese source prompt: ${question.id}`);
    if(question.options?.length!==4||new Set(question.options).size!==4)throw new Error(`invalid source options: ${question.id}`);
    if(question.options.some(option=>!hasJapanese(option)||hasChineseMarker(option)))throw new Error(`non-Japanese source option: ${question.id}`);
    if(!Number.isInteger(question.answer)||question.answer<0||question.answer>3)throw new Error(`invalid source answer: ${question.id}`);
    if(!question.evidence||!sourceText.includes(question.evidence))throw new Error(`source evidence mismatch: ${question.id}`);
    if(!hasChinese(question.explanation))throw new Error(`missing Chinese source explanation: ${question.id}`);
    sourceQuestions.set(question.id,{item,question});
  }
}
const cards=new Map([...all.vocabulary,...all.grammar].map(item=>[item.id,item]));
const examIds=new Set();
const examSignatures=new Set();
const examSources=new Set();
let examQuestionCount=0;
for(const assessment of all.assessments){
  if(assessment.questions?.length!==assessment.questionCount)throw new Error(`assessment question count mismatch: ${assessment.id}`);
  // 読解 and 聴解 questions carry the source item's own 大問 name now, so an exam is
  // checked for section coverage rather than one fixed label per section.
  for(const section of ["文字・語彙","文法","読解","聴解"])if(!assessment.questions.some(question=>question.section===section))throw new Error(`assessment section missing (${section}): ${assessment.id}`);
  // 文字・語彙 and 文法 items are built by blanking or marking a word inside its own
  // example sentence. That construction has two ways to go wrong silently: the
  // blank fails to appear (so nothing is being asked), or the sentence still
  // contains the answer (so it can be read straight off the page). A distractor
  // appearing in the sentence is the same defect from the other side.
  for(const question of assessment.questions){
    const answer=question.options[question.answer];
    if(question.logic==="vocab-cloze"||question.logic==="grammar-cloze"){
      if(!question.passage?.includes("（　）"))throw new Error(`cloze has no blank: ${question.id}`);
      if(question.passage.includes(answer))throw new Error(`cloze gives away its answer: ${question.id} (${answer})`);
      for(const option of question.options){
        if(option!==answer&&question.passage.includes(option))throw new Error(`distractor appears in the sentence: ${question.id} (${option})`);
      }
    }
    if(question.logic==="kanji-reading"||question.logic==="orthography"){
      if(!/＿.+＿/.test(question.passage||""))throw new Error(`no marked word in sentence: ${question.id}`);
      if(question.logic==="orthography"&&question.passage.includes(answer))throw new Error(`表記 sentence already shows the kanji: ${question.id} (${answer})`);
    }
  }
  for(const question of assessment.questions){
    examQuestionCount+=1;
    if(examIds.has(question.id))throw new Error(`duplicate exam question ID: ${question.id}`);examIds.add(question.id);
    const signature=`${question.passage||""}|${question.audioText||""}|${question.prompt}|${[...question.options].sort().join("/")}`;
    if(examSignatures.has(signature))throw new Error(`duplicate exam question content: ${question.id}`);examSignatures.add(signature);
    if(!hasJapanese(question.instruction)||!hasJapanese(question.prompt))throw new Error(`non-Japanese question: ${question.id}`);
    if(question.options?.length!==4||new Set(question.options).size!==4||question.options.some(option=>!hasJapanese(option)||hasChineseMarker(option)))throw new Error(`invalid Japanese options: ${question.id}`);
    if(!Number.isInteger(question.answer)||question.answer<0||question.answer>3)throw new Error(`invalid answer: ${question.id}`);
    if(!hasChinese(question.explanationZh))throw new Error(`missing Chinese answer explanation: ${question.id}`);
    const sourceId=question.sourceQuestionId||question.sourceCardId;
    if(!sourceId||examSources.has(sourceId))throw new Error(`missing or reused question source: ${question.id}`);examSources.add(sourceId);
    if(question.sourceQuestionId){
      const source=sourceQuestions.get(question.sourceQuestionId);
      if(!source)throw new Error(`source question not found: ${question.id}`);
      if(question.prompt!==source.question.prompt||JSON.stringify(question.options)!==JSON.stringify(source.question.options)||question.answer!==source.question.answer)throw new Error(`source question answer mismatch: ${question.id}`);
      const expectedText=source.item.category==="reading"?source.item.content:source.item.audioText;
      if((question.passage||question.audioText)!==expectedText)throw new Error(`source material mismatch: ${question.id}`);
      if(index.periods.indexOf(source.item.unlockPeriod)>index.periods.indexOf(assessment.unlockPeriod))throw new Error(`locked source used: ${question.id}`);
    }else{
      const card=cards.get(question.sourceCardId);
      if(!card)throw new Error(`source card not found: ${question.id}`);
      const correct=question.options[question.answer];
      if((question.logic==="kanji-reading"||question.logic==="orthography")&&!card.readingQuizEligible)throw new Error(`unreliable reading used in exam: ${question.id}`);
      if(question.logic==="kanji-reading"&&correct!==card.reading)throw new Error(`kanji reading answer mismatch: ${question.id}`);
      if(question.logic==="orthography"&&correct!==card.term)throw new Error(`orthography answer mismatch: ${question.id}`);
      if(question.logic==="grammar-function"&&(question.passage!==card.examples?.[0]?.ja||!question.explanationZh.includes(`「${correct}」`)))throw new Error(`grammar answer mismatch: ${question.id}`);
      if(index.periods.indexOf(card.unlockPeriod)>index.periods.indexOf(assessment.unlockPeriod))throw new Error(`locked card used: ${question.id}`);
    }
  }
}
if(examQuestionCount!==460)throw new Error(`exam question total mismatch: ${examQuestionCount}`);
if(examSources.size!==460)throw new Error(`exam sources are not unique: ${examSources.size}/460`);
for(const [i,schedule] of index.unlockSchedule.entries()){
  const allowed=new Set(index.periods.slice(0,i+1));
  const vocab=all.vocabulary.filter(x=>allowed.has(x.unlockPeriod)).length;
  const grammar=all.grammar.filter(x=>allowed.has(x.unlockPeriod)).length;
  if(vocab!==schedule.vocabulary||grammar!==schedule.grammar)throw new Error(`unlock mismatch ${schedule.period}: ${vocab}/${grammar}`);
}
console.log(JSON.stringify({ok:true,counts:index.counts,uniqueIds:ids.length,uniqueGrammar:new Set(all.grammar.map(x=>x.term)).size,chineseExplainedCards:all.vocabulary.length+all.grammar.length},null,2));
