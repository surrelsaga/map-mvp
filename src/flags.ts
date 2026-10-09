// A yes/no the device remembers ("has the first-open hint been dismissed?"). Never throws: without storage the answer is just no.
export const getFlag = (key: string): boolean => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
export const setFlag = (key: string, on = true) => { try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* not remembered */ } };
