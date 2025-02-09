import json
import requests
import re

def split_emoji(text):
    """Split text and emoji, return (text, emoji)."""
    # Match emoji pattern
    emoji_pattern = re.compile(r'[\U0001F300-\U0001F9FF]')
    emoji = ''.join(emoji_pattern.findall(text))
    clean_text = emoji_pattern.sub('', text).strip()
    return clean_text, emoji

def clean_noun(text):
    """Remove hyphens and convert to lowercase.
    
    Note: This function removes hyphens from nouns as they must be continuous strings
    without hyphens when used in URLs and IDs. Hyphens are only allowed in adjectives.
    Example: 't-rex' -> 'trex'
    """
    # Simply remove hyphens and convert to lowercase
    return text.replace('-', '').lower()

# download id_parts from https://raw.githubusercontent.com/bioimage-io/collection/main/bioimageio_collection_config.json
url = "https://raw.githubusercontent.com/bioimage-io/collection/main/bioimageio_collection_config.json"
config = requests.get(url).json()
id_parts = config["id_parts"]

# Initialize the dictionary with adjectives (keep hyphens in adjectives, but ensure lowercase)
# Note: Adjectives are allowed to contain hyphens (e.g., "well-fitted", "broad-minded")
ids = {
    "animal_adjective": [adj.lower() for adj in id_parts["model"]["adjectives"]],
    "fruit_adjective": [adj.lower() for adj in id_parts["dataset"]["adjectives"]],
    "object_adjective": [adj.lower() for adj in id_parts["notebook"]["adjectives"]],
}

# Process nouns and their emojis
# Note: Nouns MUST NOT contain hyphens as they are used as part of URLs and IDs
for category, emoji_key in [
    ("animal", "model"), 
    ("fruit", "dataset"), 
    ("object", "notebook")
]:
    nouns = id_parts[emoji_key]["nouns"]
    if isinstance(nouns, dict):
        # Handle dictionary case
        items = []
        emojis = []
        for key, suffix in nouns.items():
            combined = key + suffix
            name, emoji = split_emoji(combined)
            items.append(clean_noun(name))  # Remove hyphens and convert to lowercase
            emojis.append(emoji)
        ids[category] = items
        ids[f"{category}_emoji"] = emojis
    else:
        # Handle list case
        items = []
        emojis = []
        for item in nouns:
            name, emoji = split_emoji(item)
            items.append(clean_noun(name))  # Remove hyphens and convert to lowercase
            emojis.append(emoji)
        ids[category] = items
        ids[f"{category}_emoji"] = emojis

# save it as json
with open('scripts/id_parts.json', 'w', encoding='utf-8') as f:
    json.dump(ids, f, indent=4, ensure_ascii=False)
