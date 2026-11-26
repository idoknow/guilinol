import {strict as assert} from 'node:assert'
import {test} from 'node:test'
import {weakFormCount,weakPassword} from '../lib/weak-password.ts'
test('weak password policy covers dictionary and patterns without rejecting a passphrase',()=>{
  assert(weakFormCount>=200)
  for(const form of ['Password123','qwertyuiop','abcdabcd','11112222','2001-12-31'])assert(weakPassword(form))
  assert(!weakPassword('coral-tram/lime-seven'))
})
