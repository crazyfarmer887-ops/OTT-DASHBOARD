import { describe, expect, it, vi } from 'vitest';
import { parseOfficeSupplyUrl, parseOfficeInvitationPage, resolveOfficeInvitation } from '../src/lib/office-supply';

describe('Office supplier invitation extraction', () => {
  const source = 'https://micro365.ren/1y/example123';
  const invitation = 'https://aka.ms/896dc1b3c85a44e1a4c2a5f9';
  it('accepts only the expected supplier host and token path', () => {
    expect(parseOfficeSupplyUrl(source)).toEqual({ url: source, linkId: 'example123' });
    for (const value of ['http://micro365.ren/1y/a','https://micro365.ren.evil.com/1y/a','https://micro365.ren@evil.com/1y/a','https://micro365.ren/1y/a?redirect=x','https://micro365.ren:444/1y/a','https://micro365.ren/../admin']) expect(() => parseOfficeSupplyUrl(value)).toThrow();
  });
  it('extracts one Microsoft invitation only from a real link, refusing ambiguity', () => {
    expect(parseOfficeInvitationPage(`<a href="${invitation}" class="cta-btn">Accept</a>`)).toEqual({ kind: 'invitation', url: invitation });
    expect(parseOfficeInvitationPage(`<script>let fake="${invitation}"</script><a href="https://aka.ms.evil.com/token">fake</a>`)).toEqual({ kind: 'unavailable' });
    expect(() => parseOfficeInvitationPage(`<a href="${invitation}">one</a><a href="https://aka.ms/12345678abcd">two</a>`)).toThrow();
  });
  it('requires an exact href attribute and respects quoted values and duplicate attributes', () => {
    for (const html of [`<div title='<a href="${invitation}">fake</a>'>outer</div>`, `<a data-href="${invitation}">placeholder</a>`, `<a title='href="${invitation}"'>fake</a>`, `<a href="https://example.com" href="${invitation}">duplicate</a>`]) expect(parseOfficeInvitationPage(html)).toEqual({kind:'unavailable'});
    expect(parseOfficeInvitationPage(`<a title="1 > 0" href=${invitation}>real</a>`)).toEqual({kind:'invitation',url:invitation});
  });
  it('identifies the registered-email verification gate without submitting anything', async () => {
    const request = vi.fn(async () => new Response('<form id="verifyForm"><input id="em" type="email"></form>'));
    await expect(resolveOfficeInvitation(source, undefined, request)).rejects.toThrow('등록 당시 이메일');
    expect(request).toHaveBeenCalledOnce();
  });
  it('verifies the supplied email once then reads the invitation using the verification cookie', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('<form id="verifyForm"></form>'))
      .mockResolvedValueOnce(new Response('{"ok":true}', {headers:{'Set-Cookie':'link_auth=private; Path=/; HttpOnly'}}))
      .mockResolvedValueOnce(new Response(`<a href="${invitation}">Accept</a>`));
    expect(await resolveOfficeInvitation(source, 'owner@example.com', request)).toBe(invitation);
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({link_id:'example123',email:'owner@example.com'});
    expect(request.mock.calls[2][1].headers.Cookie).toBe('link_auth=private');
  });
  it('never guesses an email or follows redirects or retries an email mismatch', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('<form id="verifyForm"></form>'))
      .mockResolvedValueOnce(new Response('{"ok":false,"error":"mismatch"}',{status:400}));
    await expect(resolveOfficeInvitation(source,'owner@example.com',request)).rejects.toThrow('이메일 확인'); expect(request).toHaveBeenCalledTimes(2);
    const redirect = vi.fn(async () => new Response(null,{status:302,headers:{Location:'https://evil.com'}}));
    await expect(resolveOfficeInvitation(source,undefined,redirect)).rejects.toThrow(); expect(redirect).toHaveBeenCalledOnce();
  });
  it('does not submit to an unknown initial registration form or treat account expiry as invite expiry', async () => {
    const request = vi.fn(async () => new Response('<form id="emailForm"></form><p>2027-10-09</p>'));
    await expect(resolveOfficeInvitation(source,undefined,request)).rejects.toThrow('발급 단계'); expect(request).toHaveBeenCalledOnce();
  });
});
