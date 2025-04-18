import {
    assertUnreachable,
    getErrorMessage,
    type OrganizationMemberProfile,
    type Space,
} from '@lightdash/common';
import {
    Button,
    Group,
    MantineProvider,
    Modal,
    Title,
    type DefaultMantineColor,
} from '@mantine/core';
import { useForm, zodResolver, type UseFormReturnType } from '@mantine/form';
import { type Icon } from '@tabler/icons-react';
import { useState, type FC } from 'react';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import useToaster from '../../../hooks/toaster/useToaster';
import { useOrganizationUsers } from '../../../hooks/useOrganizationUsers';
import {
    useCreateMutation,
    useSpace,
    useSpaceDeleteMutation,
    useUpdateMutation,
} from '../../../hooks/useSpaces';
import MantineIcon from '../MantineIcon';
import { SpacePrivateAccessType } from '../ShareSpaceModal/ShareSpaceSelect';
import CreateSpaceModalContent from './CreateSpaceModalContent';
import DeleteSpaceModalContent from './DeleteSpaceModalContent';
import { ActionType, CreateModalStep } from './types';
import UpdateSpaceModalContent from './UpdateSpaceModalContent';

interface ActionModalProps {
    actionType: ActionType;
    title: string;
    icon?: Icon;
    confirmButtonLabel: string;
    confirmButtonColor?: DefaultMantineColor;
    data?: Space;
    projectUuid: string;
    spaceUuid?: string;
    onClose?: () => void;
    onSubmitForm?: (data: Space | null) => void;
    isDisabled: boolean;
    shouldRedirect?: boolean;
    parentSpaceUuid?: Space['parentSpaceUuid'];
}

export interface SpaceModalBody {
    data?: Space;
    form: UseFormReturnType<Space>;
}

export interface CreateSpaceModalBody {
    data?: Space;
    modalStep: CreateModalStep;
    projectUuid: string;
    form: UseFormReturnType<Space>;
    privateAccessType: SpacePrivateAccessType;
    onPrivateAccessTypeChange: (type: SpacePrivateAccessType) => void;
    organizationUsers: OrganizationMemberProfile[] | undefined;
    parentSpaceUuid: Space['parentSpaceUuid'];
}

const validate = z.object({
    name: z.string().min(1, { message: 'Name is required' }),
});

const SpaceModal: FC<ActionModalProps> = ({
    data,
    icon,
    title,
    confirmButtonLabel,
    confirmButtonColor = 'blue',
    isDisabled,
    actionType,
    projectUuid,
    onClose = () => {},
    onSubmitForm,
    parentSpaceUuid,
}) => {
    const { showToastError } = useToaster();
    const { data: organizationUsers } = useOrganizationUsers();
    const [privateAccessType, setPrivateAccessType] = useState(
        SpacePrivateAccessType.PRIVATE,
    );

    const [modalStep, setModalStep] = useState(CreateModalStep.SET_NAME);

    const form = useForm<Space>({
        initialValues: data,
        validate: zodResolver(validate),
    });

    const handleSubmit = (values: Space) => {
        if (
            actionType === ActionType.CREATE &&
            modalStep === CreateModalStep.SET_NAME &&
            privateAccessType === SpacePrivateAccessType.SHARED
        ) {
            setModalStep(CreateModalStep.SET_ACCESS);
            return;
        }

        try {
            onSubmitForm?.(values);
        } catch (e: any) {
            showToastError({
                title: 'Error saving',
                subtitle: getErrorMessage(e),
            });
        }
    };

    if (!projectUuid) {
        return null;
    }

    return (
        <MantineProvider inherit theme={{ colorScheme: 'light' }}>
            <Modal
                opened
                size="lg"
                title={
                    <Group spacing="xs">
                        {icon && <MantineIcon icon={icon} size="lg" />}
                        <Title order={4}>{title}</Title>
                    </Group>
                }
                onClose={onClose}
            >
                <form name={title} onSubmit={form.onSubmit(handleSubmit)}>
                    {actionType === ActionType.CREATE ? (
                        <CreateSpaceModalContent
                            projectUuid={projectUuid}
                            data={data}
                            modalStep={modalStep}
                            form={form}
                            privateAccessType={privateAccessType}
                            onPrivateAccessTypeChange={setPrivateAccessType}
                            organizationUsers={organizationUsers}
                            parentSpaceUuid={parentSpaceUuid}
                        />
                    ) : actionType === ActionType.UPDATE ? (
                        <UpdateSpaceModalContent data={data} form={form} />
                    ) : actionType === ActionType.DELETE ? (
                        <DeleteSpaceModalContent data={data} form={form} />
                    ) : (
                        assertUnreachable(
                            actionType,
                            'Unexpected action in space',
                        )
                    )}

                    <Group spacing="xs" position="right" mt="xl">
                        {actionType === ActionType.CREATE &&
                            modalStep === CreateModalStep.SET_ACCESS && (
                                <>
                                    <Button
                                        variant="light"
                                        onClick={(
                                            ev: React.MouseEvent<HTMLButtonElement>,
                                        ) => {
                                            form.setValues({
                                                access: undefined,
                                            });
                                            setModalStep(
                                                CreateModalStep.SET_NAME,
                                            );
                                            ev.preventDefault();
                                        }}
                                    >
                                        Back
                                    </Button>

                                    <Button
                                        type="submit"
                                        disabled={isDisabled || !form.isValid}
                                        color={confirmButtonColor}
                                        loading={isDisabled}
                                    >
                                        {confirmButtonLabel}
                                    </Button>
                                </>
                            )}

                        {actionType === ActionType.CREATE &&
                            modalStep === CreateModalStep.SET_NAME &&
                            !(
                                privateAccessType ===
                                SpacePrivateAccessType.PRIVATE
                            ) && (
                                <Button
                                    type="submit"
                                    disabled={isDisabled || !form.isValid}
                                >
                                    Continue
                                </Button>
                            )}

                        {(actionType !== ActionType.CREATE ||
                            (actionType === ActionType.CREATE &&
                                modalStep === CreateModalStep.SET_NAME &&
                                privateAccessType ===
                                    SpacePrivateAccessType.PRIVATE)) && (
                            <Button
                                type="submit"
                                disabled={isDisabled || !form.isValid}
                                color={confirmButtonColor}
                                loading={isDisabled}
                            >
                                {confirmButtonLabel}
                            </Button>
                        )}
                    </Group>
                </form>
            </Modal>
        </MantineProvider>
    );
};

const SpaceActionModal: FC<Omit<ActionModalProps, 'data' | 'isDisabled'>> = ({
    actionType,
    projectUuid,
    spaceUuid,
    onSubmitForm,
    shouldRedirect = true,
    parentSpaceUuid,
    ...props
}) => {
    const { data, isInitialLoading } = useSpace(projectUuid, spaceUuid, {
        enabled: !!spaceUuid,
    });
    const navigate = useNavigate();

    // Redirect to space on creation
    const { mutateAsync: createMutation, isLoading: isCreating } =
        useCreateMutation(projectUuid, {
            onSuccess: (space) => {
                if (shouldRedirect) {
                    void navigate(
                        `/projects/${projectUuid}/spaces/${space.uuid}`,
                    );
                }
            },
        });

    const { mutateAsync: updateMutation, isLoading: isUpdating } =
        useUpdateMutation(projectUuid, spaceUuid);

    const { mutateAsync: deleteMutation, isLoading: isDeleting } =
        useSpaceDeleteMutation(projectUuid);

    const handleSubmitForm = async (state: Space | null) => {
        if (!state) {
            return;
        }

        if (actionType === ActionType.CREATE) {
            const result = await createMutation({
                name: state.name,
                isPrivate: state.isPrivate,
                access: state.access?.map((access) => ({
                    userUuid: access.userUuid,
                    role: access.role,
                })),
                ...(parentSpaceUuid && {
                    parentSpaceUuid,
                }),
            });
            onSubmitForm?.(result);
        } else if (actionType === ActionType.UPDATE) {
            const result = await updateMutation({
                name: state.name,
                ...(!parentSpaceUuid && {
                    isPrivate: state.isPrivate,
                }),
            });
            onSubmitForm?.(result);
        } else if (actionType === ActionType.DELETE) {
            if (!spaceUuid) {
                return;
            }
            const result = await deleteMutation(spaceUuid);
            onSubmitForm?.(result);
        } else {
            return assertUnreachable(actionType, 'Unexpected action in space');
        }
        props.onClose?.();
    };

    if (isInitialLoading) return null;

    const isWorking = isCreating || isUpdating || isDeleting;

    return (
        <SpaceModal
            data={data}
            projectUuid={projectUuid}
            spaceUuid={spaceUuid}
            actionType={actionType}
            onSubmitForm={handleSubmitForm}
            isDisabled={isWorking}
            parentSpaceUuid={parentSpaceUuid}
            {...props}
        />
    );
};

export default SpaceActionModal;
