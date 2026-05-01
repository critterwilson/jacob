# Temporary avatar flow (pre-T10)

**Status:** Active until T10 (photo upload + moderation pipeline) is integrated.
**Remove this document when T10 is integrated into the onboarding flow.**

## What happens now

When a user completes onboarding and uploads a profile photo, the file is written
directly to Firebase Storage at:

```
users/{uid}/uncheckedAvatar
```

The download URL from this path is stored in `users/{uid}.photoURL`.

**This path bypasses the moderation pipeline.** The photo is visible only to the
uploader because:

1. `users/{uid}` documents are readable only by the owner (`isUser(uid)` in
   `firestore.rules`). Other users cannot read the `photoURL` field directly.
2. The Storage object at `users/{uid}/uncheckedAvatar` should have a Storage
   Security Rule that restricts reads to the owner. (TODO: add rule before launch.)

## What changes in T10

T10 implements the full moderation pipeline:

1. Client requests a signed upload URL from `POST /api/uploads/photos`.
2. File is PUT to the quarantine bucket.
3. Client calls `POST /api/uploads/{uploadId}/finalize`.
4. Backend runs Cloud Vision SafeSearch + CSAM hash check.
5. On pass: file is moved to the public bucket and the public URL is returned.
6. The public URL replaces the unchecked URL in `users/{uid}.photoURL`.

When T10 lands, `PhotoUpload.tsx` should be updated to use the backend signed-URL
flow instead of the direct Storage write, and this document should be deleted.

## Outstanding TODOs before public launch

- [ ] Add Firebase Storage Security Rules restricting `users/{uid}/uncheckedAvatar`
      reads to the owner.
- [ ] Integrate T10 moderation pipeline into `PhotoUpload.tsx`.
- [ ] Backfill existing unchecked avatars through the moderation pipeline.
- [ ] Delete this document.
