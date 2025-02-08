import React, { useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { ClipboardDocumentCheckIcon } from '@heroicons/react/24/outline';

interface ReviewSection {
  title: string;
  items: {
    label: string;
    key: string;
    subItems?: { label: string; key: string; }[];
  }[];
}

interface ReviewWriterProps {
  onSubmit: (comment: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

const ReviewWriter: React.FC<ReviewWriterProps> = ({ onSubmit, isOpen, onClose }) => {
  const [selectedItems, setSelectedItems] = useState<Record<string, boolean>>({});
  const [additionalComments, setAdditionalComments] = useState('');

  const reviewSections: ReviewSection[] = [
    {
      title: "1. Basic Information Completeness",
      items: [
        { 
          label: "Name is descriptive and follows convention",
          key: "name_convention"
        },
        {
          label: "Authors and maintainers properly listed",
          key: "authors_complete"
        },
        {
          label: "License is specified",
          key: "license_specified"
        },
        {
          label: "Citation information with DOI/URL included",
          key: "citation_complete"
        },
        {
          label: "Tags are relevant and help in discovery",
          key: "tags_relevant"
        }
      ]
    },
    {
      title: "2. Documentation Quality",
      items: [
        {
          label: "Description clearly explains model details",
          key: "description_clear",
          subItems: [
            { label: "Model's purpose and use case", key: "purpose_clear" },
            { label: "Input data requirements", key: "input_requirements" },
            { label: "Expected results and output format", key: "output_format" }
          ]
        },
        {
          label: "Documentation includes required elements",
          key: "documentation_complete",
          subItems: [
            { label: "Step-by-step usage instructions", key: "usage_instructions" },
            { label: "Input data specifications", key: "input_specs" },
            { label: "Example workflow or notebook", key: "example_workflow" }
          ]
        }
      ]
    },
    {
      title: "3. Technical Requirements",
      items: [
        {
          label: "Input/Output specifications complete",
          key: "io_specs_complete",
          subItems: [
            { label: "Correct axes information", key: "axes_info" },
            { label: "Data types and ranges", key: "data_types" },
            { label: "Shape requirements", key: "shape_reqs" }
          ]
        },
        {
          label: "Sample data provided",
          key: "sample_data",
          subItems: [
            { label: "Test inputs and outputs", key: "test_data" },
            { label: "Sample images for verification", key: "sample_images" },
            { label: "Cover images showing examples", key: "cover_images" }
          ]
        },
        {
          label: "Model weights and architecture properly specified",
          key: "model_specs"
        }
      ]
    },
    {
      title: "4. Visual Presentation",
      items: [
        {
          label: "Cover images quality",
          key: "cover_quality",
          subItems: [
            { label: "Clear input/output examples", key: "clear_examples" },
            { label: "Good quality and representative", key: "image_quality" },
            { label: "Include scale bars where applicable", key: "scale_bars" }
          ]
        },
        {
          label: "Icons and badges appropriate",
          key: "icons_appropriate"
        },
        {
          label: "Visual documentation helps understand model",
          key: "visual_docs"
        }
      ]
    },
    {
      title: "5. Ethical & Scientific Standards",
      items: [
        {
          label: "Training data properly cited",
          key: "training_data_cited"
        },
        {
          label: "Model limitations clearly stated",
          key: "limitations_stated"
        },
        {
          label: "Performance metrics documented",
          key: "metrics_documented"
        },
        {
          label: "Potential biases disclosed",
          key: "biases_disclosed"
        },
        {
          label: "Compliant with data privacy guidelines",
          key: "privacy_compliant"
        }
      ]
    }
  ];

  const handleToggleItem = (key: string) => {
    setSelectedItems(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const generateReviewComment = () => {
    let comment = "## Review Summary\n\n";
    
    // Add sections with their findings
    reviewSections.forEach(section => {
      const sectionItems = section.items.filter(item => 
        selectedItems[item.key] || 
        (item.subItems?.some(sub => selectedItems[sub.key]))
      );

      if (sectionItems.length > 0) {
        comment += `### ${section.title}\n`;
        
        sectionItems.forEach(item => {
          comment += `✓ ${item.label}\n`;
          
          if (item.subItems) {
            item.subItems.forEach(sub => {
              if (selectedItems[sub.key]) {
                comment += `  - ${sub.label}\n`;
              }
            });
          }
        });
        comment += '\n';
      }
    });

    // Add missing items as improvement suggestions
    const missingItems = reviewSections.flatMap(section => 
      section.items.filter(item => !selectedItems[item.key])
    );

    if (missingItems.length > 0) {
      comment += "### Suggested Improvements\n";
      missingItems.forEach(item => {
        comment += `* ${item.label}\n`;
      });
      comment += '\n';
    }

    // Add additional comments if any
    if (additionalComments.trim()) {
      comment += "### Additional Comments\n";
      comment += additionalComments.trim() + '\n';
    }

    return comment;
  };

  const handleSubmit = () => {
    const reviewComment = generateReviewComment();
    onSubmit(reviewComment);
    onClose();
    setSelectedItems({});
    setAdditionalComments('');
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white px-4 pb-4 pt-5 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-4xl sm:p-6">
              <div>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                  <ClipboardDocumentCheckIcon className="h-6 w-6 text-blue-600" aria-hidden="true" />
                </div>
                <div className="mt-3 text-center sm:mt-5">
                  <Dialog.Title as="h3" className="text-base font-semibold leading-6 text-gray-900">
                    Review Checklist
                  </Dialog.Title>
                  <div className="mt-2">
                    <p className="text-sm text-gray-500">
                      Select the items that meet the requirements to generate a structured review comment.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 max-h-[60vh] overflow-y-auto">
                <div className="space-y-6">
                  {reviewSections.map((section) => (
                    <div key={section.title} className="bg-gray-50 rounded-lg p-4">
                      <h4 className="text-sm font-medium text-gray-900 mb-3">{section.title}</h4>
                      <div className="space-y-3">
                        {section.items.map((item) => (
                          <div key={item.key}>
                            <label className="flex items-start">
                              <input
                                type="checkbox"
                                checked={selectedItems[item.key] || false}
                                onChange={() => handleToggleItem(item.key)}
                                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                              />
                              <span className="ml-2 text-sm text-gray-700">{item.label}</span>
                            </label>
                            {item.subItems && selectedItems[item.key] && (
                              <div className="ml-6 mt-2 space-y-2">
                                {item.subItems.map((subItem) => (
                                  <label key={subItem.key} className="flex items-start">
                                    <input
                                      type="checkbox"
                                      checked={selectedItems[subItem.key] || false}
                                      onChange={() => handleToggleItem(subItem.key)}
                                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                                    />
                                    <span className="ml-2 text-sm text-gray-600">{subItem.label}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4">
                  <label htmlFor="additional-comments" className="block text-sm font-medium text-gray-700">
                    Additional Comments
                  </label>
                  <textarea
                    id="additional-comments"
                    rows={4}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                    placeholder="Add any additional comments or specific feedback..."
                    value={additionalComments}
                    onChange={(e) => setAdditionalComments(e.target.value)}
                  />
                </div>
              </div>

              <div className="mt-5 sm:mt-6 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-3">
                <button
                  type="button"
                  className="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:col-start-2"
                  onClick={handleSubmit}
                >
                  Generate Review
                </button>
                <button
                  type="button"
                  className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:col-start-1 sm:mt-0"
                  onClick={onClose}
                >
                  Cancel
                </button>
              </div>
            </Dialog.Panel>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
};

export default ReviewWriter; 