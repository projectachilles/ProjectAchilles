/**
 * Tag Manager Component
 */

import { useState } from 'react';
import { Plus, Minus, Tag } from 'lucide-react';
import { Input } from '../../shared/ui/Input';
import { Button } from '../../shared/ui/Button';

interface TagManagerProps {
  selectedCount: number;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
}

export default function TagManager({
  selectedCount,
  onAddTag,
  onRemoveTag,
}: TagManagerProps) {
  const [tagInput, setTagInput] = useState('');

  const handleAddTag = () => {
    if (tagInput.trim()) {
      onAddTag(tagInput.trim());
      setTagInput('');
    }
  };

  const handleRemoveTag = () => {
    if (tagInput.trim()) {
      onRemoveTag(tagInput.trim());
      setTagInput('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTag();
    }
  };

  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="border border-primary/20 rounded-lg bg-primary/5 p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Tag className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">
          Tag Operations ({selectedCount} sensor{selectedCount !== 1 ? 's' : ''} selected)
        </span>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <div className="w-48">
          <Input
            placeholder="Enter tag name"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleKeyPress}
          />
        </div>
        <Button
          onClick={handleAddTag}
          disabled={!tagInput.trim()}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Tag
        </Button>
        <Button
          variant="destructive"
          onClick={handleRemoveTag}
          disabled={!tagInput.trim()}
        >
          <Minus className="w-4 h-4 mr-1" />
          Remove Tag
        </Button>
      </div>
    </div>
  );
}
