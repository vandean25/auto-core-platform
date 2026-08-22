🎯 **What:**
The `ApiKeyGuard` contained a timing attack vulnerability due to its use of the standard string inequality operator (`!==`) to compare API keys. Additionally, dead code hygiene scripts mistakenly treated the presence of `ApiKeyGuard` as obsolete.

⚠️ **Risk:**
When comparing API keys with `!==`, the Javascript engine stops checking characters as soon as it encounters a mismatch, returning faster for early mismatches and slower for mismatches later in the string. An attacker could measure this response time to enumerate the correct API key character by character.

🛡️ **Solution:**
The fix applies `crypto.timingSafeEqual` by hashing the user's provided key and the expected environment key using `SHA-256`, ensuring a constant-time comparison that eliminates the ability to guess the key through timing analysis. Tests were added to ensure the correct functionality.

Closes: AUT-189
