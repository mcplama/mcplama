# Copyright (c) 2026 MCPlama <dev@mcplama.com>
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
oauth_flow.py — MERGED INTO oauth.py

All functionality from this file has been merged into:
  backend/app/api/v1/endpoints/oauth.py

This file is kept only so imports don't crash during transition.
Remove it once main.py import is cleaned up.
"""
from app.api.v1.endpoints.oauth import (
    router as oauth_router,
    get_valid_oauth_token,
)

# Re-export so any existing imports still resolve
__all__ = ["oauth_router", "get_valid_oauth_token"]