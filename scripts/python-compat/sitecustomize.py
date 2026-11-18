"""
FreeGPT: Python compatibility for Android/Linux environments.

Some Android-hosted Linux environments have a broken posix_spawn
implementation for ELF executables. Force subprocess to use fork/exec.
"""

import subprocess

subprocess._USE_POSIX_SPAWN = False
