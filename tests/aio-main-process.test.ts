import {describe,it,expect} from 'vitest';
import {aioOwnerMatches} from '../src/lib/aio-main-process';

describe('AIO publication process identity',()=>{
 it('accepts only the live, exact systemd main process ID',()=>{
  expect(aioOwnerMatches('12345\n',12345)).toBe(true);
  for(const value of ['0','12346','12345x','+12345','01','', '90071992547409999'])
   expect(aioOwnerMatches(value,12345)).toBe(false);
 });
});
