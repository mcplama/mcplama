# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

import base64
import hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.core.config import settings
import os


def _get_key() -> bytes:
    key_material = settings.TOKEN_ENCRYPTION_KEY.encode()
    return hashlib.sha256(key_material).digest()


def encrypt(plaintext: str, context: str = "") -> str:
    """
    context (optional) is bound into the AES-GCM auth tag as associated data.
    It is never encrypted and never stored — the caller must supply the exact
    same string to decrypt(). This ties a ciphertext to the row/field it was
    written for: a blob copied into a different row (e.g. by someone with raw
    DB write access via some other bug) fails to decrypt instead of silently
    decrypting under the wrong identity.

    Blobs written without a context (context="") use the legacy "enc:" format
    for backward compatibility with data encrypted before this existed.
    """
    if not plaintext:
        return plaintext
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    if context:
        ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), context.encode())
        prefix = "enc2:"
    else:
        ciphertext = aesgcm.encrypt(nonce, plaintext.encode(), None)
        prefix = "enc:"
    combined = nonce + ciphertext
    return prefix + base64.urlsafe_b64encode(combined).decode()


def decrypt(ciphertext: str, context: str = "") -> str:
    """
    context must match what was passed to encrypt() for this value. Ignored
    for legacy "enc:" blobs (encrypted before AAD binding existed) so existing
    data keeps decrypting with zero migration.
    """
    if not ciphertext:
        return ciphertext
    key = _get_key()
    aesgcm = AESGCM(key)
    if ciphertext.startswith("enc2:"):
        combined = base64.urlsafe_b64decode(ciphertext[5:])
        nonce = combined[:12]
        data = combined[12:]
        return aesgcm.decrypt(nonce, data, context.encode() if context else None).decode()
    if not ciphertext.startswith("enc:"):
        return ciphertext
    combined = base64.urlsafe_b64decode(ciphertext[4:])
    nonce = combined[:12]
    data = combined[12:]
    return aesgcm.decrypt(nonce, data, None).decode()


def encrypt_dict(d: dict, context_prefix: str = "") -> dict:
    sensitive = {"token", "access_token", "refresh_token", "client_secret", "password"}
    return {
        k: encrypt(v, f"{context_prefix}:{k}" if context_prefix else "") if k in sensitive and isinstance(v, str) and v else v
        for k, v in d.items()
    }


def decrypt_dict(d: dict, context_prefix: str = "") -> dict:
    sensitive = {"token", "access_token", "refresh_token", "client_secret", "password"}
    return {
        k: decrypt(v, f"{context_prefix}:{k}" if context_prefix else "") if k in sensitive and isinstance(v, str) and v else v
        for k, v in d.items()
    }
