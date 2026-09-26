// Validate a response file against the request's schema and draw an overlay of the answered geometry.
import fs from 'fs';
import path from 'path';
import { validate } from '/home/user/KJ-energy-calculator/app/ai/validate.js';
const EX = path.join(path.dirname(new URL(import.meta.url).pathname), 'exchange');
const id = process.argv[2];
const req = JSON.parse(fs.readFileSync(path.join(EX, 'requests', id, 'request.json'), 'utf8'));
const resFile = path.join(EX, 'responses', `${id}.json`);
const res = JSON.parse(fs.readFileSync(resFile, 'utf8'));
const data = res.response !== undefined ? res.response : res;
const v = validate(data, req.schema);
console.log(id, req.jobType, v.ok ? 'VALID' : 'INVALID', v.errors.slice(0, 10).join('\n'));
if (!v.ok) process.exit(1);
// emit an overlay spec for python
const spec = { image: req.images[0] ? path.join(EX, 'requests', id, req.images[0]) : null, walls: data.walls || data.walls_upsert || [], rooms: data.rooms || data.rooms_upsert || [], openings: data.openings || data.openings_upsert || [], gaps: data.gaps || data.gaps_upsert || [], refs: data.reference_measurements || [], region: data.drawing_region || null, outline: data.building_outline || [], levels: data.levels || [], vopenings: (data.openings && data.openings[0] && data.openings[0].w_px !== undefined) ? data.openings : [] };
fs.writeFileSync(path.join(EX, 'responses', `${id}.overlay.json`), JSON.stringify(spec));
