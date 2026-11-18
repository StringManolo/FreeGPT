# Uso (desde la raíz del repo):  source scripts/sandbox-env.sh
# Solo para ejecutar udocker a mano contra el sandbox de FreeGPT.
export UDOCKER_DIR="$PWD/.sandbox/udocker"
export PYTHONPATH="$PWD/scripts/python-compat${PYTHONPATH:+:$PYTHONPATH}"
echo "UDOCKER_DIR=$UDOCKER_DIR"
