import { ErrorMessage } from '@hookform/error-message';
import { type ArgumentsOf } from '@lightdash/common';
import { ActionIcon, Group, Stack, Text } from '@mantine/core';
import { IconHelpCircle } from '@tabler/icons-react';
import React, {
    useState,
    type FC,
    type ReactElement,
    type ReactNode,
} from 'react';
import { Controller, get, useFormContext } from 'react-hook-form';
import DocumentationHelpButton from '../DocumentationHelpButton';
import MantineIcon from '../common/MantineIcon';

interface InputProps {
    id: string;
    disabled?: boolean;
    placeholder?: string;
}

export interface InputWrapperProps {
    name: string;
    label?: string;
    description?: string | ReactNode;
    disabled?: boolean;
    placeholder?: string;
    defaultValue?: any;
    documentationUrl?: string;
    className?: string;
    labelHelp?: string | ReactNode;
    helperText?: string | ReactNode;
    rules?: React.ComponentProps<typeof Controller>['rules'];
    render: (
        inputProps: InputProps,
        controllerProps: ArgumentsOf<
            React.ComponentPropsWithRef<typeof Controller>['render']
        >[0],
    ) => ReactElement<any>;
    style?: React.CSSProperties;
}

const InputWrapper: FC<InputWrapperProps> = ({
    name,
    defaultValue,
    documentationUrl,
    label,
    rules,
    render,
    className,
    labelHelp,
    helperText,
    ...rest
}) => {
    const {
        control,
        formState: { errors },
    } = useFormContext();
    const id = `${name}-input`;
    const requiredLabel = rules?.required ? '*' : '';

    const [isLabelInfoOpen, setIsLabelInfoOpen] = useState<boolean>(false);
    const error = get(errors, name);
    return (
        <Stack className={`input-wrapper ${className}`} spacing="two">
            <Group spacing="xs" position="apart">
                <Text fw={450}>
                    {label} <span style={{ flex: 1 }}>{requiredLabel}</span>
                </Text>

                {documentationUrl && !labelHelp && (
                    <DocumentationHelpButton href={documentationUrl} />
                )}
                {labelHelp && (
                    <ActionIcon
                        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.preventDefault();
                            setIsLabelInfoOpen(!isLabelInfoOpen);
                        }}
                    >
                        <MantineIcon icon={IconHelpCircle} />
                    </ActionIcon>
                )}
            </Group>
            {isLabelInfoOpen && <Text>{labelHelp}</Text>}

            <Controller
                control={control}
                name={name}
                rules={rules}
                defaultValue={defaultValue}
                render={(controllerProps) =>
                    render({ id, ...rest }, controllerProps)
                }
            />
            {error && <ErrorMessage errors={errors} name={name} as="p" />}
        </Stack>
    );
};

export default InputWrapper;
