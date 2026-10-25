import seed from '../content/seed.json';
import reference from '../content/stl-reference.json';
/** One content catalog for the UI, coach tools and diagnostics. */
interface Problem { id: string; title: string; url: string; }
interface StudyList { id: string; date: string; items: string[]; }
interface Doc { id: string; title: string; kind: string; body: string; version: string; }
const catalog: { problems: Problem[]; lists: StudyList[]; docs: Doc[] } = { ...seed, docs: [...seed.docs, ...reference.docs] };
export default catalog;
