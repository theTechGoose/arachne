# SFTP Path Metadata Parser

## Mental Model

1. File uploaded to SFTPGo via a webhook-authenticated user, lands at a local
   path like: `<sftp_base>/username/customerId=abc/type=invoice/filename.pdf`

2. `Deno.watchFs` detects the new file.

3. Path is parsed — segments split by `/`, each directory segment after the 
   root must be `key=value`. The first segment (username) becomes a metadata
   field. Filename minus extension becomes `name`.

4. Produces a freeform DTO:
   `{ name: "filename", user: "username", customerId: "abc", type: "invoice" }`

5. Validator checks that two required keys are present — fails the upload if
   missing.

6. DTO is handed off to the consumer (recordings-app / Firestore).

## Decisions Made

- Invalid `key=value` segment: fail the upload
- Duplicate keys: not allowed, first wins
- Filename extension: stripped, base name becomes `name`
- Username/root segment: is a metadata field
- Schema: freeform — any key=value is valid, post-parse validator enforces
  required fields
- "Fail the upload": TBD (see questions below)
- Watcher: `Deno.watchFs` on local directory that SFTPGo writes to

## Spec Questions from Claude

1. What are the two required keys every upload must have?

2. Is the username segment a plain value (producing e.g. `{ user: "username" }`)
   or does SFTPGo structure it so the root segment is already `key=value`
   (e.g. `user=alex`)?

3. What does "fail the upload" mean in practice — delete the file and log,
   return an error response to the uploader, or something else?
