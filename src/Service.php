<?php

namespace ConsentForLaravel\ConsentForLaravel;

final readonly class Service
{
    public function __construct(
        public string $id,
        public Category $category,
        public string $name,
        public string $description,
    ) {}

    /** @return array{id: string, category: string, name: string, description: string} */
    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'category' => $this->category->value,
            'name' => $this->name,
            'description' => $this->description,
        ];
    }
}
