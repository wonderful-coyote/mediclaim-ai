import hashlib
import hmac
import base64
import time
import uuid

def generate_interswitch_auth(client_id, secret_key, http_method, resource_url):
    timestamp = str(int(time.time()))
    nonce = str(uuid.uuid4()).replace("-", "")
    
    # The Interswitch signature is a SHA-256 hash of these combined values
    signature_base = f"{http_method}&{resource_url}&{timestamp}&{nonce}&{client_id}&{secret_key}"
    signature = hashlib.sha256(signature_base.encode()).hexdigest()
    
    return {
        "Authorization": f"InterswitchAuth {base64.b64encode(client_id.encode()).decode()}",
        "Timestamp": timestamp,
        "Nonce": nonce,
        "Signature": signature,
        "SignatureMethod": "SHA256"
    }