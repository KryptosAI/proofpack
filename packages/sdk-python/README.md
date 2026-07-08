# ProofPack Python SDK

```bash
pip install proofpack-sdk
```

```python
from proofpack import ProofPack, ProofEventType

pp = ProofPack(api_key="ppk_your_key")

pp.track(ProofPack.ProofEventPayload(
    user_id="user_abc",
    event=ProofEventType.OUTPUT_GENERATED,
    metadata={"model": "gpt-4", "tokens": 2400},
))

pp.shutdown()
```
