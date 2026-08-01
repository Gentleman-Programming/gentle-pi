# Overlay: comment-writer

Pi-specific delta applied on top of `skills/_vendor/comment-writer/SKILL.md`
to produce `skills/comment-writer/SKILL.md`. Do not hand-edit the vendored
file above; edit this file instead.

<!-- overlay:block -->
<!-- overlay:anchor -->
| Match target context language | Write in the target context language by default: Spanish issue/thread -> Spanish comment, English issue/thread -> English comment, mixed context -> target message language. If the user explicitly requests a language or tone, follow that request. For Spanish comments, use neutral/professional Spanish by default unless the user or target context clearly calls for regional tone. |
<!-- overlay:replace -->
| Match target context language | Write in the target context language by default: Spanish issue/thread -> Spanish comment, English issue/thread -> English comment, mixed context -> target message language. If the user explicitly requests a language or tone, follow that request. Do not use the active persona as the source of truth for public comments. For Spanish comments, use neutral/professional Spanish by default unless the user or target context clearly calls for regional tone. |
<!-- overlay:end -->
