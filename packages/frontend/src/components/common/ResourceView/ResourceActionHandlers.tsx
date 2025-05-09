import {
    assertUnreachable,
    ChartSourceType,
    convertChartSourceTypeToDashboardTileType,
    ResourceViewItemType,
    type ResourceViewChartItem,
    type ResourceViewDashboardItem,
    type ResourceViewSpaceItem,
    type Space,
} from '@lightdash/common';
import {
    IconFolderCog,
    IconFolderPlus,
    IconFolderX,
} from '@tabler/icons-react';
import { useCallback, useEffect, type FC } from 'react';
import { useParams } from 'react-router';
import { DeleteSqlChartModal } from '../../../features/sqlRunner/components/DeleteSqlChartModal';
import { useUpdateSqlChartMutation } from '../../../features/sqlRunner/hooks/useSavedSqlCharts';
import { useMoveDashboardMutation } from '../../../hooks/dashboard/useDashboard';
import { useChartPinningMutation } from '../../../hooks/pinning/useChartPinningMutation';
import { useDashboardPinningMutation } from '../../../hooks/pinning/useDashboardPinningMutation';
import { useSpacePinningMutation } from '../../../hooks/pinning/useSpaceMutation';
import { useMoveChartMutation } from '../../../hooks/useSavedQuery';
import {
    useMoveSpaceMutation,
    useSpaceSummaries,
} from '../../../hooks/useSpaces';
import AddTilesToDashboardModal from '../../SavedDashboards/AddTilesToDashboardModal';
import SpaceActionModal from '../SpaceActionModal';
import { ActionType } from '../SpaceActionModal/types';
import TransferItemsModal from '../TransferItemsModal/TransferItemsModal';
import ChartDeleteModal from '../modal/ChartDeleteModal';
import ChartDuplicateModal from '../modal/ChartDuplicateModal';
import ChartUpdateModal from '../modal/ChartUpdateModal';
import DashboardDeleteModal from '../modal/DashboardDeleteModal';
import DashboardDuplicateModal from '../modal/DashboardDuplicateModal';
import DashboardUpdateModal from '../modal/DashboardUpdateModal';
import {
    ResourceViewItemAction,
    type ResourceViewItemActionState,
} from './types';

interface ResourceActionHandlersProps {
    action: ResourceViewItemActionState;
    onAction: (action: ResourceViewItemActionState) => void;
}

const ResourceActionHandlers: FC<ResourceActionHandlersProps> = ({
    action,
    onAction,
}) => {
    const { projectUuid } = useParams<{ projectUuid: string }>();
    const { data: spaces } = useSpaceSummaries(projectUuid, true, {});

    const { mutateAsync: moveChart, isLoading: isMovingChart } =
        useMoveChartMutation();
    const { mutateAsync: updateSqlChart, isLoading: isUpdatingSqlChart } =
        useUpdateSqlChartMutation(
            projectUuid,
            '',
            '', // TODO: get slug or savedSqlUuid to invalidate the query if necessary
        );

    const { mutateAsync: moveSpace, isLoading: isMovingSpace } =
        useMoveSpaceMutation(projectUuid);

    const { mutateAsync: moveDashboard, isLoading: isMovingDashboard } =
        useMoveDashboardMutation();
    const { mutate: pinChart } = useChartPinningMutation();
    const { mutate: pinDashboard } = useDashboardPinningMutation();
    const { mutate: pinSpace } = useSpacePinningMutation(projectUuid);

    const handleReset = useCallback(() => {
        onAction({ type: ResourceViewItemAction.CLOSE });
    }, [onAction]);

    const moveToSpace = useCallback(
        (
            item:
                | ResourceViewChartItem
                | ResourceViewDashboardItem
                | ResourceViewSpaceItem,
            spaceUuid: string | null,
        ) => {
            switch (item.type) {
                case ResourceViewItemType.CHART:
                    if (!spaceUuid) {
                        throw new Error(
                            'Space UUID is required to move a chart',
                        );
                    }

                    if (item.data.source === ChartSourceType.SQL) {
                        return updateSqlChart({
                            savedSqlUuid: item.data.uuid,
                            unversionedData: {
                                name: item.data.name,
                                description: item.data.description || null,
                                spaceUuid: spaceUuid,
                            },
                        });
                    }
                    return moveChart({
                        uuid: item.data.uuid,
                        spaceUuid,
                    });
                case ResourceViewItemType.DASHBOARD:
                    if (!spaceUuid) {
                        throw new Error(
                            'Space UUID is required to move a dashboard',
                        );
                    }

                    return moveDashboard({
                        uuid: item.data.uuid,
                        name: item.data.name,
                        spaceUuid,
                    });
                case ResourceViewItemType.SPACE:
                    return moveSpace({
                        spaceUuid: item.data.uuid,
                        parentSpaceUuid: spaceUuid ?? null,
                    });
                default:
                    return assertUnreachable(
                        item,
                        'Resource type not supported',
                    );
            }
        },
        [moveChart, moveDashboard, moveSpace, updateSqlChart],
    );

    const handleCreateSpace = useCallback(
        async (space: Space | null) => {
            if (!space) return;
            if (action.type !== ResourceViewItemAction.CREATE_SPACE) return;

            await moveToSpace(action.item, space.uuid);
        },
        [action, moveToSpace],
    );

    const handlePinToHomepage = useCallback(() => {
        if (action.type !== ResourceViewItemAction.PIN_TO_HOMEPAGE) return;

        switch (action.item.type) {
            case ResourceViewItemType.CHART:
                return pinChart({ uuid: action.item.data.uuid });
            case ResourceViewItemType.DASHBOARD:
                return pinDashboard({ uuid: action.item.data.uuid });
            case ResourceViewItemType.SPACE:
                return pinSpace(action.item.data.uuid);
            default:
                return assertUnreachable(
                    action.item,
                    'Resource type not supported',
                );
        }
    }, [action, pinChart, pinDashboard, pinSpace]);

    useEffect(() => {
        if (action.type === ResourceViewItemAction.PIN_TO_HOMEPAGE) {
            handlePinToHomepage();
            handleReset();
        }
    }, [action, handlePinToHomepage, handleReset]);

    if (!projectUuid) {
        return null;
    }

    switch (action.type) {
        case ResourceViewItemAction.UPDATE:
            switch (action.item.type) {
                case ResourceViewItemType.CHART:
                    return (
                        <ChartUpdateModal
                            opened
                            uuid={action.item.data.uuid}
                            onClose={handleReset}
                            onConfirm={handleReset}
                        />
                    );
                case ResourceViewItemType.DASHBOARD:
                    return (
                        <DashboardUpdateModal
                            opened
                            uuid={action.item.data.uuid}
                            onClose={handleReset}
                            onConfirm={handleReset}
                        />
                    );
                case ResourceViewItemType.SPACE:
                    return (
                        <SpaceActionModal
                            projectUuid={projectUuid}
                            spaceUuid={action.item.data.uuid}
                            actionType={ActionType.UPDATE}
                            title="Update space"
                            confirmButtonLabel="Update"
                            icon={IconFolderCog}
                            onClose={handleReset}
                            onSubmitForm={handleReset}
                            parentSpaceUuid={action.item.data.parentSpaceUuid}
                        />
                    );
                default:
                    return assertUnreachable(
                        action.item,
                        'Action type not supported',
                    );
            }
        case ResourceViewItemAction.DELETE:
            switch (action.item.type) {
                case ResourceViewItemType.CHART:
                    if (action.item.data.source === ChartSourceType.SQL) {
                        return (
                            <DeleteSqlChartModal
                                opened
                                savedSqlUuid={action.item.data.uuid}
                                onClose={handleReset}
                                onSuccess={handleReset}
                                projectUuid={projectUuid}
                                name={action.item.data.name}
                            />
                        );
                    }
                    return (
                        <ChartDeleteModal
                            opened
                            uuid={action.item.data.uuid}
                            onClose={handleReset}
                            onConfirm={handleReset}
                        />
                    );
                case ResourceViewItemType.DASHBOARD:
                    return (
                        <DashboardDeleteModal
                            opened
                            uuid={action.item.data.uuid}
                            onClose={handleReset}
                            onConfirm={handleReset}
                        />
                    );
                case ResourceViewItemType.SPACE:
                    return (
                        <SpaceActionModal
                            projectUuid={projectUuid}
                            spaceUuid={action.item.data.uuid}
                            actionType={ActionType.DELETE}
                            title="Delete space"
                            confirmButtonLabel="Delete"
                            confirmButtonColor="red"
                            icon={IconFolderX}
                            onClose={handleReset}
                            onSubmitForm={handleReset}
                            parentSpaceUuid={null}
                        />
                    );

                default:
                    return assertUnreachable(
                        action.item,
                        'Resource type not supported',
                    );
            }
        case ResourceViewItemAction.ADD_TO_DASHBOARD:
            return action.item.data.source ? (
                <AddTilesToDashboardModal
                    isOpen
                    projectUuid={projectUuid}
                    uuid={action.item.data.uuid}
                    dashboardTileType={convertChartSourceTypeToDashboardTileType(
                        action.item.data.source,
                    )}
                    onClose={handleReset}
                />
            ) : null;
        case ResourceViewItemAction.CREATE_SPACE:
            return (
                <SpaceActionModal
                    shouldRedirect={false}
                    projectUuid={projectUuid}
                    actionType={ActionType.CREATE}
                    title="Create new space"
                    confirmButtonLabel="Create"
                    icon={IconFolderPlus}
                    onClose={handleReset}
                    onSubmitForm={handleCreateSpace}
                    parentSpaceUuid={null}
                />
            );

        case ResourceViewItemAction.DUPLICATE:
            switch (action.item.type) {
                case ResourceViewItemType.CHART:
                    return (
                        <ChartDuplicateModal
                            opened
                            uuid={action.item.data.uuid}
                            onClose={handleReset}
                            onConfirm={handleReset}
                        />
                    );
                case ResourceViewItemType.DASHBOARD:
                    return (
                        <DashboardDuplicateModal
                            opened
                            uuid={action.item.data.uuid}
                            onClose={handleReset}
                            onConfirm={handleReset}
                        />
                    );
                default:
                    return assertUnreachable(
                        action.item,
                        'Resource type not supported',
                    );
            }

        case ResourceViewItemAction.TRANSFER_TO_SPACE:
            return (
                <TransferItemsModal
                    projectUuid={projectUuid}
                    opened
                    onClose={handleReset}
                    items={[action.item]}
                    spaces={spaces ?? []}
                    isLoading={
                        isMovingChart ||
                        isMovingDashboard ||
                        isUpdatingSqlChart ||
                        isMovingSpace
                    }
                    onConfirm={async (spaceUuid) => {
                        await moveToSpace(action.item, spaceUuid);
                        handleReset();
                    }}
                />
            );

        case ResourceViewItemAction.CLOSE:
        case ResourceViewItemAction.PIN_TO_HOMEPAGE:
            return null;
        default:
            return assertUnreachable(action, 'action type not supported');
    }
};

export default ResourceActionHandlers;
