import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTypeScript } from './helpers/load-typescript.mjs';

const { isCardBlocked, prerequisiteCandidates }=loadTypeScript('lib/card-prerequisites.ts');
const { CardView }=loadTypeScript('components/Card.tsx');
const prerequisite={id:'buy',title:'Buy domain name',status:'backlog'};
const card={id:'dns',title:'Update DNS',status:'research',prerequisite_card_id:'buy'};

test('only Complete satisfies a prerequisite; terminal cards hide the blocked indicator',()=>{
  assert.equal(isCardBlocked({...card,prerequisite_card_id:null}),false);
  for(const status of ['backlog','priority_backlog','research','waiting','in_progress','review','canceled']) {
    assert.equal(isCardBlocked(card,{...prerequisite,status}),true);
  }
  assert.equal(isCardBlocked(card,{...prerequisite,status:'complete'}),false);
  assert.equal(isCardBlocked(card),true);
  for(const status of ['complete','canceled']) assert.equal(isCardBlocked({...card,status},prerequisite),false);
});

test('blocked cards render both an outline class and the prerequisite name',()=>{
  const render=prereq=>renderToStaticMarkup(React.createElement(CardView,{card,prerequisite:prereq}));
  assert.match(render(prerequisite),/card-blocked/);
  assert.match(render(prerequisite),/Blocked by: Buy domain name/);
  assert.doesNotMatch(render({...prerequisite,status:'complete'}),/card-blocked/);
  assert.match(render(undefined),/unavailable prerequisite/);
});

test('candidate selection excludes self and transitive dependents while retaining completed cards',()=>{
  const third={id:'third',title:'Third',status:'complete',prerequisite_card_id:'dns'};
  const other={id:'other',title:'Already complete',status:'complete'};
  const cards=[third,card,prerequisite,other];
  assert.deepEqual(prerequisiteCandidates(cards,'buy'),[other]);
  assert.deepEqual(prerequisiteCandidates(cards,'dns'),[other,prerequisite]);
  assert.equal(prerequisiteCandidates(cards).length,4);
});
