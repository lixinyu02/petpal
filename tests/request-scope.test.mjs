import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestScope, SessionChangedError } from '../src/auth/request-scope.mjs';

test('account replacement aborts active transports and fences results even if abort is ignored', () => {
  const scope = createRequestScope({url:'https://old.example',token:'old'});
  const request = scope.begin();
  const snapshot = scope.connection(); snapshot.token = 'tampered';
  scope.replace({url:'https://new.example',token:'new'});
  assert.equal(request.signal.aborted,true);
  assert.deepEqual(request.connection,{url:'https://old.example',token:'old'});
  assert.throws(()=>request.assertCurrent(),SessionChangedError);
  assert.throws(()=>{request.connection.token='tampered';},TypeError);
  assert.deepEqual(scope.connection(),{url:'https://new.example',token:'new'});
  const next=scope.begin();next.assertCurrent();next.close();request.close();
});

test('external cancellation is isolated and detached after completion', () => {
  const scope=createRequestScope(),source=new AbortController();
  const first=scope.begin(source.signal),second=scope.begin();
  source.abort(new Error('stopped'));
  assert.throws(()=>first.assertCurrent(),/stopped/);second.assertCurrent();
  first.close();second.close();
  const later=new AbortController(),closed=scope.begin(later.signal);closed.close();later.abort();
  assert.equal(closed.signal.aborted,false);
  const already=scope.begin(source.signal);assert.equal(already.signal.aborted,true);already.close();
});

test('a closed request is still unable to deliver a stale result', () => {
  const scope=createRequestScope(),request=scope.begin();request.close();
  scope.replace({url:'',token:'another'});
  assert.equal(request.signal.aborted,false);
  assert.throws(()=>request.assertCurrent(),SessionChangedError);
});
